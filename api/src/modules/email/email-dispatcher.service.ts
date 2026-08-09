import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
  email_provider_config as EmailProviderConfig,
  email_queue as EmailQueueRow,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { EmailProvider, EmailQueueStatus, UserStatus } from '../../database/enums';
import { BrevoService } from './brevo.service';
import { ResendService } from './resend.service';
import { EmailTemplateName } from './email.constants';

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 20;

@Injectable()
export class EmailDispatcherService {
  private readonly logger = new Logger(EmailDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly brevo: BrevoService,
    private readonly resend: ResendService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async dispatchPending(): Promise<void> {
    const providerConfig = await this.getOrCreateConfig();
    this.resetDailyCountersIfNeeded(providerConfig);

    const now = new Date();
    // TypeORM took an array of where-objects as an OR; Prisma spells that out.
    const batch = await this.prisma.email_queue.findMany({
      where: {
        status: EmailQueueStatus.PENDING,
        OR: [{ sendAfter: null }, { sendAfter: { lte: now } }],
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: BATCH_SIZE,
    });

    for (const email of batch) {
      await this.sendOne(email, providerConfig);
    }

    // providerConfig is still mutated in memory across the batch and written
    // once at the end, exactly as before -- one write per run, not per email.
    await this.prisma.email_provider_config.update({
      where: { id: providerConfig.id },
      data: {
        brevoSentToday: providerConfig.brevoSentToday,
        resendSentToday: providerConfig.resendSentToday,
        lastResetDate: providerConfig.lastResetDate,
      },
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async inactivityCheck(): Promise<void> {
    const now = new Date();

    const days = (n: number) => new Date(now.getTime() - n * 86400000);

    const users60 = await this.prisma.users.findMany({
      where: {
        status: UserStatus.ACTIVE,
        lastLoginAt: { lt: days(60), gte: days(61) },
      },
    });

    for (const u of users60) {
      this.logger.log(`60-day inactivity: queuing re-engagement for ${u.email}`);
    }

    const users90 = await this.prisma.users.findMany({
      where: {
        status: UserStatus.ACTIVE,
        lastLoginAt: { lt: days(90), gte: days(91) },
      },
    });

    for (const u of users90) {
      this.logger.log(`90-day inactivity: queuing final warning for ${u.email}`);
    }

    const users120 = await this.prisma.users.findMany({
      where: {
        status: UserStatus.ACTIVE,
        lastLoginAt: { lt: days(120) },
      },
    });

    for (const u of users120) {
      this.logger.log(`120-day inactivity: soft deleting ${u.email}`);
      await this.prisma.users.update({
        where: { id: u.id },
        data: {
          status: UserStatus.DELETED,
          deletedAt: now,
          hardDeleteAt: new Date(now.getTime() + 30 * 86400000),
        },
      });
    }

    const users150 = await this.prisma.users.findMany({
      where: {
        hardDeleteAt: { lte: now },
        deletedAt: { not: null },
      },
    });

    for (const u of users150) {
      this.logger.log(`Hard deleting ${u.email}`);
      await this.prisma.users.delete({ where: { id: u.id } });
    }
  }

  private async sendOne(
    email: EmailQueueRow,
    providerConfig: EmailProviderConfig,
  ): Promise<void> {
    // Collected rather than mutated-and-saved: Prisma writes an explicit patch,
    // so the fields that change are accumulated and written once at the end,
    // matching the single save() the entity version performed.
    const patch: Prisma.email_queueUpdateInput = {
      attempts: email.attempts + 1,
      lastAttemptAt: new Date(),
    };

    const useBrevo =
      providerConfig.brevoEnabled &&
      (await this.brevo.isConfigured()) &&
      providerConfig.brevoSentToday < providerConfig.brevoDailyLimit;

    const useResend =
      !useBrevo &&
      providerConfig.resendOverflowEnabled &&
      (await this.resend.isConfigured()) &&
      providerConfig.resendSentToday < providerConfig.resendDailyLimit;

    if (!useBrevo && !useResend) {
      patch.status = EmailQueueStatus.BLOCKED;
      patch.errorMessage = 'No provider available or daily limit reached';
      await this.prisma.email_queue.update({ where: { id: email.id }, data: patch });
      return;
    }

    try {
      if (useBrevo) {
        await this.brevo.send({
          toEmail: email.toEmail,
          toName: email.toName,
          subject: email.subject,
          templateName: email.templateId as EmailTemplateName | undefined,
          templateParams: (email.templateParams as Record<string, unknown>) ?? undefined,
          htmlBody: email.htmlBody,
          textBody: email.textBody,
        });
        patch.provider = EmailProvider.BREVO;
        providerConfig.brevoSentToday += 1;
      } else {
        await this.resend.send({
          toEmail: email.toEmail,
          toName: email.toName,
          subject: email.subject,
          htmlBody: email.htmlBody,
          textBody: email.textBody,
        });
        patch.provider = EmailProvider.GMAIL;
        providerConfig.resendSentToday += 1;
      }

      patch.status = EmailQueueStatus.SENT;
      patch.sentAt = new Date();
    } catch (err) {
      this.logger.error(`Failed to send email ${email.id}: ${(err as Error).message}`);
      patch.errorMessage = (err as Error).message;
      // attempts was incremented into the patch, not onto the row, so the
      // retry ceiling is compared against the incremented value.
      patch.status =
        email.attempts + 1 >= MAX_ATTEMPTS ? EmailQueueStatus.FAILED : EmailQueueStatus.PENDING;
    }

    await this.prisma.email_queue.update({ where: { id: email.id }, data: patch });
  }

  private async getOrCreateConfig(): Promise<EmailProviderConfig> {
    const existing = await this.prisma.email_provider_config.findUnique({ where: { id: 1 } });
    if (existing) return existing;
    return this.prisma.email_provider_config.create({
      data: {
        brevoEnabled: true,
        resendOverflowEnabled: false,
        brevoDailyLimit: 300,
        resendDailyLimit: 1000,
        brevoSentToday: 0,
        resendSentToday: 0,
        lastResetDate: new Date(),
      },
    });
  }

  /**
   * last_reset_date is a DATE column. The entity typed it as a 'YYYY-MM-DD'
   * string so this was a string comparison; Prisma surfaces DATE as a Date at
   * UTC midnight, so the day is compared explicitly rather than by identity —
   * two Date objects for the same day are never ===.
   */
  private resetDailyCountersIfNeeded(config: EmailProviderConfig): void {
    const today = new Date();
    const sameDay =
      config.lastResetDate.getUTCFullYear() === today.getUTCFullYear() &&
      config.lastResetDate.getUTCMonth() === today.getUTCMonth() &&
      config.lastResetDate.getUTCDate() === today.getUTCDate();
    if (!sameDay) {
      config.brevoSentToday = 0;
      config.resendSentToday = 0;
      config.lastResetDate = today;
    }
  }
}
