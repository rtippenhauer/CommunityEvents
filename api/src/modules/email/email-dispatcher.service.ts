import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { newEmailProviderConfig } from '../../common/email/email-config-defaults';
import { quotaDayStart, resolveQuotaTimeZone } from '../../common/email/quota-day';
import { BrevoService } from './brevo.service';
import { ResendService } from './resend.service';
import { EmailTemplateName } from './email.constants';

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 20;

/**
 * What is left of the shared account allowance, decremented as a batch spends
 * it.
 *
 * `null` means there is no daily cap to hold anything against -- no key, Brevo
 * unreachable, or a prepaid plan whose balance is not a daily figure. That is
 * deliberately permissive: an unknown budget must not stop a deployment
 * sending, because the local per-community limit is still in force underneath.
 */
interface AccountRoom {
  remaining: number | null;
}

@Injectable()
export class EmailDispatcherService {
  private readonly logger = new Logger(EmailDispatcherService.name);

  /**
   * The zone the provider accounts reset their daily allowance in.
   *
   * Read once, here, rather than per send: it is deployment config that cannot
   * change without a restart, and resolving it on every counter check would
   * repeat the same validation thousands of times a day.
   */
  private readonly quotaTimeZone: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly brevo: BrevoService,
    private readonly resend: ResendService,
    private readonly config: ConfigService,
  ) {
    const resolved = resolveQuotaTimeZone(this.config.get<string>('EMAIL_QUOTA_TIMEZONE'));
    if (resolved.invalid) {
      this.logger.warn(
        `EMAIL_QUOTA_TIMEZONE="${resolved.invalid}" is not a time zone this runtime knows; ` +
          'daily send counters will roll over at UTC midnight instead.',
      );
    }
    this.quotaTimeZone = resolved.timeZone;
  }

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
        await this.rollOverIfDayChanged(providerConfig);

        // Before the batch, because the decision each send makes is only as
        // good as this number -- and once per batch rather than once per
        // message, which is the same freshness for a twentieth of the calls.
        const quota = await this.brevo.getAccountQuota();
        const room: AccountRoom = {
          remaining: quota?.isDailyAllowance ? quota.remaining : null,
        };

        const brevoBefore = providerConfig.brevoSentToday;
        const resendBefore = providerConfig.resendSentToday;

        let anySent = false;
        for (const email of emails) {
          anySent = (await this.sendOne(email, providerConfig, room)) || anySent;
        }

        // Written as a delta, not as the absolute the batch arrived at.
        //
        // This was `brevoSentToday: <what we counted to>`, which was correct
        // while the dispatcher was the only thing that ever wrote the column.
        // It no longer is: `sendNow` counts password resets and verifications
        // the moment they go out, from ordinary requests that can land in the
        // middle of this batch. An absolute write would silently discard them
        // -- and the counter losing sends is the failure that started all this.
        //
        // Still one write per community per run, not one per email. updateMany
        // for the same reason as the queue writes below: nothing in this
        // scheduled sweep is wrapped in a try/catch, so a P2025 here becomes an
        // unhandled rejection rather than a logged failure.
        const brevoDelta = providerConfig.brevoSentToday - brevoBefore;
        const resendDelta = providerConfig.resendSentToday - resendBefore;
        if (brevoDelta || resendDelta || anySent) {
          await this.prisma.email_provider_config.updateMany({
            where: { id: providerConfig.id },
            data: {
              ...(brevoDelta ? { brevoSentToday: { increment: brevoDelta } } : {}),
              ...(resendDelta ? { resendSentToday: { increment: resendDelta } } : {}),
              // Not a statistic. Brevo deactivates an API key after 90 days of
              // inactivity, so this is what lets the admin screen warn a quiet
              // community before its key stops working.
              ...(anySent ? { lastSuccessfulSendAt: new Date() } : {}),
            },
          });
        }

        // After the batch, the number we hold is a batch out of date. Dropped
        // rather than re-fetched: the next caller that needs it will fetch it,
        // and on a quiet deployment that is a page load rather than a cron.
        if (brevoDelta) await this.brevo.invalidateAccountQuota();
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

  /** Returns whether the message actually left, which the caller records. */
  private async sendOne(
    email: EmailQueueRow,
    providerConfig: EmailProviderConfig,
    room: AccountRoom,
  ): Promise<boolean> {
    // Collected rather than mutated-and-saved: Prisma writes an explicit patch,
    // so the fields that change are accumulated and written once at the end,
    // matching the single save() the entity version performed.
    const patch: Prisma.email_queueUpdateInput = {
      attempts: email.attempts + 1,
      lastAttemptAt: new Date(),
    };

    // Two independent budgets, and both have to allow the send.
    //
    // The per-community limit says how much of the deployment's sending this
    // community may account for. The account allowance says how much there
    // actually is -- and it is shared, because a community with no key of its
    // own sends on the deployment's. Two communities each under their own limit
    // of 300 will spend 350 of one 300/day account between them and be cut off
    // having never exceeded what either believed was its budget. Only the
    // account number can see that coming.
    const accountHasRoom = room.remaining === null || room.remaining > 0;
    const useBrevo =
      providerConfig.brevoEnabled &&
      (await this.brevo.isConfigured()) &&
      providerConfig.brevoSentToday < providerConfig.brevoDailyLimit &&
      accountHasRoom;

    const useResend =
      !useBrevo &&
      providerConfig.resendOverflowEnabled &&
      (await this.resend.isConfigured()) &&
      providerConfig.resendSentToday < providerConfig.resendDailyLimit;

    if (!useBrevo && !useResend) {
      patch.status = EmailQueueStatus.BLOCKED;
      // Named separately, because the two cases need different responses from
      // an operator: one is a setting on this screen, the other is an account
      // that is out of allowance until tomorrow no matter what is configured.
      patch.errorMessage = accountHasRoom
        ? 'No provider available or daily limit reached'
        : "Brevo account's daily allowance is spent";
      // updateMany, not update: this row was read at the top of the sweep and
      // may be gone by now -- cancelled by an admin, or removed by a retention
      // pass. TypeORM's update() reported affected: 0; Prisma's update() throws
      // P2025, and because this runs on a scheduler there is no request to
      // surface that on, so it becomes an unhandled rejection inside a cron.
      await this.prisma.email_queue.updateMany({ where: { id: email.id }, data: patch });
      return false;
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
        // Spent from the shared allowance too, so the rest of this batch sees
        // it. The stored counter stays what this community sent; this is what
        // the account has left, and they are no longer the same question.
        if (room.remaining !== null) room.remaining -= 1;
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
    return patch.status === EmailQueueStatus.SENT;
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
    return this.prisma.email_provider_config.create({ data: newEmailProviderConfig() });
  }

  /**
   * Zeroes the counters if the provider's sending day has turned over.
   *
   * This used to compare calendar days in UTC, which is a guess about when the
   * provider's allowance resets and, for a US operator, the wrong one by four
   * or five hours. `quotaDayStart` draws the boundary in `EMAIL_QUOTA_TIMEZONE`
   * instead; see `quota-day.ts` for why the guess was not merely cosmetic.
   *
   * Persisted here rather than folded into the write at the end of the batch,
   * because the batch's write is now a delta and a reset is not one.
   *
   * `lastResetDate` is set to the boundary itself rather than to now, so the
   * column says when the window opened -- which is what the admin screen shows
   * and what the immediate-send path compares against.
   */
  private async rollOverIfDayChanged(config: EmailProviderConfig): Promise<void> {
    const dayStart = quotaDayStart(new Date(), this.quotaTimeZone);
    if (config.lastResetDate.getTime() >= dayStart.getTime()) return;

    // The `lt` is repeated in the where clause rather than trusted from the row
    // we read: `sendNow` performs the same rollover, and whichever of the two
    // gets there first should be the only one that zeroes the counter.
    await this.prisma.email_provider_config.updateMany({
      where: { id: config.id, lastResetDate: { lt: dayStart } },
      data: { brevoSentToday: 0, resendSentToday: 0, lastResetDate: dayStart },
    });

    config.brevoSentToday = 0;
    config.resendSentToday = 0;
    config.lastResetDate = dayStart;
  }

}
