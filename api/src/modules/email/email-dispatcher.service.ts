import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type {
  email_provider_config as EmailProviderConfig,
  email_queue as EmailQueueRow,
  Prisma,
} from '@prisma/client';
import { runUnscoped, runWithTenant } from '../../common/tenant/tenant-store';
import {
  AUTO_DELETE_ELIGIBLE,
  EXCLUDE_SERVICE_ACCOUNTS,
} from '../../common/utils/service-account.util';
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

  /**
   * The scheduled entry point, which drains every tenant's queue in one pass.
   *
   * The waiver lives here rather than on dispatchPending itself, and the
   * difference matters: the admin "flush" button calls dispatchPending from
   * inside a request, where a tenant context is already established, so that
   * path stays scoped and flushes only the caller's own queue. Wrapping the
   * shared body instead would quietly turn one community's admin action into a
   * deployment-wide one.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  dispatchPendingScheduled(): Promise<void> {
    return runUnscoped('email dispatcher drains every tenant queue', () =>
      this.dispatchPending(),
    );
  }

  /**
   * Drains the queue, one community at a time.
   *
   * Finding the batch is deliberately done in whatever context the caller is
   * in: the cron wraps this in `runUnscoped` and gets every community's mail,
   * while Admin -> Send Now runs inside a request and gets only that
   * community's. **Sending is always re-entered per tenant**, because as of
   * v2-9 the provider settings are per-community -- the API key, the sending
   * identity and the daily counter all belong to the community whose message
   * this is. Sending the whole batch under one config would mail every
   * community through whichever account the engine happened to load first,
   * which is the v2-6 trap one layer down.
   */
  async dispatchPending(): Promise<void> {
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

    // Grouped rather than sorted-and-scanned so each community's config is
    // loaded and written exactly once, as the single config was before.
    const byTenant = new Map<number, EmailQueueRow[]>();
    for (const email of batch) {
      const list = byTenant.get(email.tenantId);
      if (list) list.push(email);
      else byTenant.set(email.tenantId, [email]);
    }

    for (const [tenantId, emails] of byTenant) {
      await runWithTenant(tenantId, async () => {
        const providerConfig = await this.getOrCreateConfig();
        this.resetDailyCountersIfNeeded(providerConfig);

        for (const email of emails) {
          await this.sendOne(email, providerConfig);
        }

        // Still mutated in memory across the batch and written once at the end
        // -- one write per community per run, not per email. updateMany for the
        // same reason as the queue writes below: nothing in this scheduled
        // sweep is wrapped in a try/catch, so a P2025 here becomes an unhandled
        // rejection rather than a logged failure.
        await this.prisma.email_provider_config.updateMany({
          where: { id: providerConfig.id },
          data: {
            brevoSentToday: providerConfig.brevoSentToday,
            resendSentToday: providerConfig.resendSentToday,
            lastResetDate: providerConfig.lastResetDate,
          },
        });
      });
    }
  }

  /** Re-engagement mail for members who have gone quiet, across every tenant. */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  inactivityCheck(): Promise<void> {
    return runUnscoped('inactivity sweep covers every tenant', () =>
      this.runInactivityCheck(),
    );
  }

  private async runInactivityCheck(): Promise<void> {
    const now = new Date();

    const days = (n: number) => new Date(now.getTime() - n * 86400000);

    // Two different exclusions here, and the difference is deliberate.
    //
    // Every stage skips service accounts: they are not people to re-engage, and
    // they drift into the inactivity window by design rather than by neglect
    // (they either never sign in or do so rarely), so the deletion stages would
    // eventually remove them and orphan the audit and release-notes rows
    // pointing at them.
    //
    // The two *deletion* stages additionally skip admins and system admins
    // (AUTO_DELETE_ELIGIBLE). Every interactive delete path already refuses
    // them; this sweep was the one actor that could remove an admin with no
    // confirmation and no reviewer. Admins still get the 60- and 90-day nudges
    // -- being reminded is the point, being deleted on a timer is not.

    const users60 = await this.prisma.users.findMany({
      where: {
        ...EXCLUDE_SERVICE_ACCOUNTS,
        status: UserStatus.ACTIVE,
        lastLoginAt: { lt: days(60), gte: days(61) },
      },
    });

    for (const u of users60) {
      this.logger.log(`60-day inactivity: queuing re-engagement for ${u.email}`);
    }

    const users90 = await this.prisma.users.findMany({
      where: {
        ...EXCLUDE_SERVICE_ACCOUNTS,
        status: UserStatus.ACTIVE,
        lastLoginAt: { lt: days(90), gte: days(91) },
      },
    });

    for (const u of users90) {
      this.logger.log(`90-day inactivity: queuing final warning for ${u.email}`);
    }

    const users120 = await this.prisma.users.findMany({
      where: {
        ...AUTO_DELETE_ELIGIBLE,
        status: UserStatus.ACTIVE,
        lastLoginAt: { lt: days(120) },
      },
    });

    for (const u of users120) {
      this.logger.log(`120-day inactivity: soft deleting ${u.email}`);
      // This loop is not guarded, and the user may have deleted their own
      // account between the findMany above and this write.
      await this.prisma.users.updateMany({
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
        ...AUTO_DELETE_ELIGIBLE,
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
      // updateMany, not update: this row was read at the top of the sweep and
      // may be gone by now -- cancelled by an admin, or removed by a retention
      // pass. TypeORM's update() reported affected: 0; Prisma's update() throws
      // P2025, and because this runs on a scheduler there is no request to
      // surface that on, so it becomes an unhandled rejection inside a cron.
      await this.prisma.email_queue.updateMany({ where: { id: email.id }, data: patch });
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

    // Same reasoning as the blocked branch above: the row may have been removed
    // while the provider call was in flight.
    await this.prisma.email_queue.updateMany({ where: { id: email.id }, data: patch });
  }

  /**
   * This community's provider settings, created empty on first use.
   *
   * A community with no row falls back to the deployment's env vars for the key
   * and identity (see BrevoService.getEffectiveConfig); what the row adds is
   * somewhere to keep its own counters, which is why one is created rather than
   * the send being skipped.
   */
  private async getOrCreateConfig(): Promise<EmailProviderConfig> {
    const existing = await this.prisma.email_provider_config.findFirst();
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
