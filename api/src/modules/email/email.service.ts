import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type {
  email_queue as EmailQueueRow,
  notification_preferences as NotificationPreferences,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { EmailQueueStatus, EmailStatus, SuppressionReason } from '../../database/enums';
import { EmailTemplateName, NOTIFICATION_PREF_KEY } from './email.constants';
import { BrevoService, EmailAttachment } from './brevo.service';
import { quotaDayStart, resolveQuotaTimeZone } from '../../common/email/quota-day';
import { AppConfigService } from '../app-config/app-config.service';

/**
 * The placeholder every email writes instead of a hard-coded product name.
 *
 * Substituted here rather than at each call site, so a new email gets branding
 * by writing `{{brand}}` and nothing else. Before this, nine subjects and
 * bodies said "DinnerBears" outright, which reached a real member on the v2-7
 * stage pass from a sender correctly named "Community Events Project".
 */
export const BRAND_PLACEHOLDER = /\{\{\s*brand\s*\}\}/g;

const NOTIFICATION_PREF_FIELDS = [
  'emailInvite',
  'emailVerification',
  'emailPasswordReset',
  'emailPasswordChanged',
  'emailSecurityAlert',
  'emailEventPublished',
  'emailRsvpConfirmation',
  'emailEventReminder',
  'emailAccountDeletion',
  'emailReengagement',
  'pushEventPublished',
  'pushEventReminder',
  'pushAnnouncement',
] as const satisfies readonly (keyof NotificationPreferences)[];

export interface QueueEmailDto {
  toEmail: string;
  toName?: string | null;
  subject: string;
  templateId?: EmailTemplateName;
  templateParams?: Record<string, unknown>;
  htmlBody?: string | null;
  textBody?: string | null;
  priority?: number;
  sendAfter?: Date;
  bypassSuppression?: boolean;
  userId?: number;
  attachments?: EmailAttachment[];
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly suppressionSalt: string;
  /** The zone the provider's daily allowance resets in. See quota-day.ts. */
  private readonly quotaTimeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly brevo: BrevoService,
    private readonly appConfig: AppConfigService,
  ) {
    this.suppressionSalt = this.config.get<string>('EMAIL_SUPPRESSION_SALT', 'default-salt');
    // Same setting the dispatcher reads, resolved the same way. Both paths
    // write the same counter, so both have to agree on when the day turns over
    // or one of them undoes the other's reset.
    this.quotaTimeZone = resolveQuotaTimeZone(
      this.config.get<string>('EMAIL_QUOTA_TIMEZONE'),
    ).timeZone;
  }

  private hashEmail(email: string): string {
    return createHash('sha256')
      .update(this.suppressionSalt + email.toLowerCase())
      .digest('hex');
  }

  async isSuppressed(email: string): Promise<boolean> {
    const hash = this.hashEmail(email);
    const record = await this.prisma.email_suppressions.findUnique({
      where: { emailHash: hash },
    });
    return record !== null;
  }

  async suppress(email: string, reason: SuppressionReason): Promise<void> {
    const hash = this.hashEmail(email);
    // upsert rather than check-then-insert: emailHash is unique, and two
    // webhook deliveries for the same address can race the read.
    await this.prisma.email_suppressions.upsert({
      where: { emailHash: hash },
      update: {},
      create: { emailHash: hash, reason },
    });
  }

  async removeSuppression(email: string): Promise<void> {
    const hash = this.hashEmail(email);
    await this.prisma.email_suppressions.deleteMany({ where: { emailHash: hash } });
  }

  private async checkNotificationPref(userId: number, template: EmailTemplateName): Promise<boolean> {
    const prefKey = NOTIFICATION_PREF_KEY[template];
    if (!prefKey) return true;

    const prefs = await this.prisma.notification_preferences.findUnique({ where: { userId } });
    if (!prefs) return true;

    // These columns are generic `tinyint`, not TypeORM's special `boolean` type,
    // so the driver returns 0/1 rather than false/true — comparing against the
    // literal `false` here always passed, silently defeating every opt-out.
    const value = (prefs as unknown as Record<string, boolean | number>)[prefKey];
    return Number(value) !== 0;
  }

  /**
   * Replaces `{{brand}}` with this community's name, everywhere a member reads.
   *
   * Runs at *enqueue* time, not at dispatch. That matters: the dispatcher cron
   * drains every tenant's queue under one `runUnscoped`, so a substitution
   * there would resolve whichever community the engine reached first. Here we
   * are still inside the caller's tenant context, and the row that lands in
   * `email_queue` already carries the right name.
   *
   * `brand` is also added to `templateParams`, so a Brevo-side template can use
   * `{{ params.brand }}` without the caller passing it. That only helps
   * templates written to reference it -- Brevo renders its own copy, and this
   * code cannot reach inside one.
   */
  private async applyBranding(dto: QueueEmailDto): Promise<QueueEmailDto> {
    const brand = await this.appConfig.brandName();
    const swap = (value: string | null | undefined): string | null | undefined =>
      typeof value === 'string' ? value.replace(BRAND_PLACEHOLDER, brand) : value;

    return {
      ...dto,
      subject: swap(dto.subject) as string,
      htmlBody: swap(dto.htmlBody),
      textBody: swap(dto.textBody),
      templateParams: { brand, ...(dto.templateParams ?? {}) },
    };
  }

  async queue(input: QueueEmailDto): Promise<EmailQueueRow | null> {
    const dto = await this.applyBranding(input);

    if (!dto.bypassSuppression) {
      const suppressed = await this.isSuppressed(dto.toEmail);
      if (suppressed) {
        this.logger.warn(`Email to ${dto.toEmail} suppressed — skipping`);
        return null;
      }
    }

    if (dto.userId && dto.templateId) {
      const user = await this.prisma.users.findUnique({ where: { id: dto.userId } });
      if (user) {
        if (
          user.emailStatus === EmailStatus.BOUNCED ||
          user.emailStatus === EmailStatus.COMPLAINED
        ) {
          this.logger.debug(`Email to ${dto.toEmail} blocked — status: ${user.emailStatus}`);
          return null;
        }
        const allowed = await this.checkNotificationPref(dto.userId, dto.templateId);
        if (!allowed) {
          this.logger.debug(`Email to ${dto.toEmail} skipped — preference disabled for ${dto.templateId}`);
          return null;
        }
      }
    }

    return this.prisma.email_queue.create({
      data: {
        toEmail: dto.toEmail,
        toName: dto.toName ?? null,
        subject: dto.subject,
        templateId: dto.templateId ?? null,
        // Nullable Json column: Prisma separates a SQL NULL from a JSON null,
        // and DbNull is what the entity wrote.
        templateParams: (dto.templateParams as Prisma.InputJsonValue) ?? Prisma.DbNull,
        htmlBody: dto.htmlBody ?? null,
        textBody: dto.textBody ?? null,
        priority: dto.priority ?? 5,
        sendAfter: dto.sendAfter ?? null,
        status: EmailQueueStatus.PENDING,
      },
    });
  }

  async sendNow(input: QueueEmailDto): Promise<void> {
    // Branded before the attempt, so the queued copy on failure carries the
    // same text the immediate send would have. queue() substitutes again and
    // finds nothing left to replace, which is the intended no-op.
    const dto = await this.applyBranding(input);

    try {
      await this.brevo.send({
        toEmail: dto.toEmail,
        toName: dto.toName,
        subject: dto.subject,
        htmlBody: dto.htmlBody,
        textBody: dto.textBody,
        attachments: dto.attachments,
      });
      await this.countImmediateSend();
      // The account allowance we hold is now one send out of date. Dropping it
      // rather than re-reading it is what keeps this off the critical path: a
      // password reset is something a person is waiting on, and clearing a map
      // entry costs nothing where another call to Brevo would have tripled the
      // time this endpoint takes. Whoever asks next pays for the fresh number.
      await this.brevo.invalidateAccountQuota();
    } catch (err) {
      this.logger.warn(`Immediate send failed for ${dto.toEmail}, falling back to queue: ${(err as Error).message}`);
      await this.queue({ ...dto, bypassSuppression: true });
    }
  }

  /**
   * Counts a send that skipped the queue.
   *
   * `sendNow` calls the provider directly, so it never passed through the
   * dispatcher that maintains `brevoSentToday` -- which meant password resets,
   * email verification, the lockout alert and two event mails were invisible to
   * the one number that exists to track how much of the daily allowance is
   * gone. Found on stage: resets arrived and the counter never moved.
   *
   * An atomic `increment` rather than read-modify-write: unlike the dispatcher,
   * which owns its batch and writes once at the end, these fire from ordinary
   * requests that can overlap.
   *
   * `updateMany` so a community with no row yet is a no-op rather than a throw.
   * Nothing here is worth failing a password reset over.
   *
   * Deliberately does NOT enforce the daily limit. The dispatcher refuses to
   * send past it; this path is for mail somebody is waiting on -- a reset link,
   * a verification, a security alert -- and a quota is a worse reason to
   * withhold those than it is to delay a queued invite. The counter still tells
   * the truth about what was used.
   */
  private async countImmediateSend(): Promise<void> {
    try {
      const dayStart = quotaDayStart(new Date(), this.quotaTimeZone);

      // The rollover, expressed as a condition the database evaluates, so two
      // statements -- Prisma has no conditional increment. Both are safe to
      // interleave with the dispatcher, which is why neither reads the row and
      // writes it back: the counter only ever takes "zero it if the window has
      // moved on", "add one", and the reconciliation's correction. The
      // dispatcher's own write was changed to a delta for the same reason, as
      // an absolute would have discarded whatever this counted mid-batch.
      await this.prisma.email_provider_config.updateMany({
        where: { lastResetDate: { lt: dayStart } },
        data: { brevoSentToday: 0, resendSentToday: 0, lastResetDate: dayStart },
      });

      await this.prisma.email_provider_config.updateMany({
        data: { brevoSentToday: { increment: 1 }, lastSuccessfulSendAt: new Date() },
      });
    } catch (err) {
      // Never let bookkeeping fail the send it is describing.
      this.logger.warn(`Could not record an immediate send: ${(err as Error).message}`);
    }
  }

  async getQueue(limit = 100): Promise<EmailQueueRow[]> {
    return this.prisma.email_queue.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async cancelEmail(id: number): Promise<void> {
    // Cancelling an email that is already gone is a no-op, not an error --
    // the admin queue view can easily be a few seconds stale. TypeORM's
    // update() reported affected: 0 here; Prisma's update() throws P2025,
    // which would surface as a 500 on a second click.
    await this.prisma.email_queue.updateMany({
      where: { id },
      data: { status: EmailQueueStatus.CANCELLED },
    });
  }

  async retryFailed(): Promise<number> {
    const result = await this.prisma.email_queue.updateMany({
      where: { status: EmailQueueStatus.FAILED },
      data: { status: EmailQueueStatus.PENDING, attempts: 0, errorMessage: null },
    });
    return result.count;
  }

  async getNotificationPrefs(userId: number): Promise<NotificationPreferences> {
    // The create-if-missing pair collapses into one upsert; column defaults
    // supply every preference, exactly as the empty entity did.
    return this.prisma.notification_preferences.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async updateNotificationPrefs(
    userId: number,
    updates: Partial<Pick<NotificationPreferences, (typeof NOTIFICATION_PREF_FIELDS)[number]>>,
  ): Promise<NotificationPreferences> {
    const data: Record<string, boolean> = {};
    for (const key of NOTIFICATION_PREF_FIELDS) {
      const value = updates[key];
      if (value !== undefined) {
        data[key] = value as boolean;
      }
    }
    return this.prisma.notification_preferences.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
  }
}
