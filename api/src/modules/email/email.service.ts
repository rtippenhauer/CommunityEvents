import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type {
  email_queue as EmailQueueRow,
  notification_preferences as NotificationPreferences,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { EmailProvider, EmailQueueStatus, EmailStatus, SuppressionReason } from '../../database/enums';
import { EmailCategory, EmailCategoryName, EmailTemplateName, NOTIFICATION_PREF_KEY } from './email.constants';
import { BrevoService, EmailAttachment } from './brevo.service';
import { quotaDayStart, resolveQuotaTimeZone } from '../../common/email/quota-day';
import { AppConfigService } from '../app-config/app-config.service';
import { currentTenantId, requireTenantId } from '../../common/tenant/tenant-store';
import { emailPalette } from '../../common/utils/color.util';
import { EmailLogQueryDto } from './dto/email-log-query.dto';

/**
 * One row of the email log (v2-31).
 *
 * Everything the list renders, and nothing it does not: `htmlBody`, `textBody`
 * and `templateParams` are absent on purpose, because they are most of the
 * table's bytes and none of its searchable surface. `EmailLogContent` carries
 * them for the single row somebody expands.
 */
export type EmailLogRow = Omit<
  EmailQueueRow,
  'htmlBody' | 'textBody' | 'templateParams' | 'tenantId' | 'bodyClearedAt'
>;

export interface EmailLogPage {
  rows: EmailLogRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
  /**
   * How many messages this community holds in each status, **ignoring the
   * filters and the page**.
   *
   * Needed because the screen's "Retry failed" button and its counts used to be
   * derived from the loaded rows, which was correct only while every row was
   * loaded. Under pagination that silently becomes "failed on this page",
   * so a second page of failures would report none and the button would
   * disappear with work still outstanding.
   */
  counts: Record<string, number>;
  usage: EmailLogUsage;
}

/**
 * How much this community's email log is actually read (Rob, 2026-10-03).
 *
 * Bodies are cleared at 30 days; whether the rows themselves should go at 6 or
 * 12 months is deliberately undecided, and this is the evidence for deciding it
 * later. `deepestAgeDays` is the column that answers the question -- if nobody
 * has opened anything older than a month, six months is plainly safe.
 */
export interface EmailLogUsage {
  /** Days in the last 90 on which somebody opened the log. */
  daysReviewed: number;
  /** Age in days of the oldest message anybody has reached, ever. */
  deepestAgeDays: number;
  lastReviewedAt: Date | null;
}

export interface EmailLogContent {
  id: number;
  templateParams: Prisma.JsonValue | null;
  htmlBody: string | null;
  textBody: string | null;
}

/**
 * Widens a bare `YYYY-MM-DD` to the end of that same UTC day, so an inclusive
 * `to` date includes the day it names.
 *
 * Without this, `to=2026-10-02` parses as that day's midnight and excludes
 * everything sent during it — a filter that looks like it works while quietly
 * dropping the most recent day, which is the day somebody filtering by date is
 * usually asking about.
 *
 * **UTC throughout, and the UI does not rely on it.** `setUTCHours` to match
 * how `new Date('YYYY-MM-DD')` parsed it; reading the string as UTC and then
 * setting local hours would shift the bound by the server's offset, which is
 * the bug this comment replaced. The admin screen sends full ISO instants from
 * its date picker, converted from the viewer's own midnight, so the only caller
 * that sees the date-only rule is a human querying by hand.
 *
 * Deliberately **not** `quotaDayStart`. That names the instant a *provider's*
 * allowance resets, which is a different question from which messages a reader
 * wants to see — borrowing it would make this screen a second, disagreeing
 * answer to "when does a day begin".
 */
function endOfDayIfDateOnly(value: string): Date {
  const parsed = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return parsed;
  parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
}

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
  /**
   * Why this message exists, for the admin log. Inert -- nothing branches on it.
   * Omitted means `other`, which is honest rather than a guess.
   */
  category?: EmailCategoryName;
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
  /** How long a sent message's rendered body is kept. See clearOldBodies. */
  private readonly bodyRetentionDays: number;

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
    // 30 days by default (Rob, 2026-10-03). A floor of 1 rather than 0: a value
    // of zero would clear a body the moment it was written, which is a
    // misconfiguration that destroys data silently rather than an opt-out.
    const configured = Number(this.config.get<string>('EMAIL_BODY_RETENTION_DAYS', '30'));
    this.bodyRetentionDays =
      Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : 30;
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

    const swapped = swap(dto.htmlBody);

    return {
      ...dto,
      subject: swap(dto.subject) as string,
      htmlBody: await this.wrapHtmlBody(swapped, brand),
      textBody: swap(dto.textBody),
      templateParams: { brand, ...(dto.templateParams ?? {}) },
    };
  }

  /**
   * Gives a bare HTML body the community's own header, ground and footer.
   *
   * Only some emails ever had a design. The event templates in
   * `events.service` build a full document with a logo band; the invite,
   * password-reset, verification and security-alert bodies were bare fragments
   * -- an `<h2>` and a couple of paragraphs, rendered by the mail client on
   * whatever white it defaults to, with no logo and nothing identifying the
   * community that sent them. That is not DinnerBears branding to replace, it
   * is branding that was never there, which is why v2-10's earlier passes did
   * not catch it.
   *
   * Wrapping happens here rather than in each caller for the same reason the
   * brand substitution above does: this runs at enqueue time, inside the
   * caller's tenant context, so `absoluteLogoUrl()` and the palette resolve to
   * the community actually sending. The dispatcher cron would resolve whichever
   * community the engine reached first.
   *
   * A body that is already a full document is returned untouched -- wrapping
   * one would nest `<html>` inside `<body>` and give it two logos.
   */
  private async wrapHtmlBody(
    html: string | null | undefined,
    brand: string,
  ): Promise<string | null | undefined> {
    if (typeof html !== 'string' || !html.trim()) return html;
    // A character class rather than a word boundary: it reads as plainly and
    // avoids an escape that is easy to mangle when this file is edited by
    // anything other than a human -- a stray backspace here silently turned
    // the guard off and wrapped documents that were already complete.
    if (/^\s*<(!doctype|html)[\s>]/i.test(html)) return html;

    const [tagline, logoUrl, primary, background] = await Promise.all([
      this.appConfig.getSiteSetting('brand_tagline'),
      this.appConfig.absoluteLogoUrl(),
      this.appConfig.getSiteSetting('theme_color_primary'),
      this.appConfig.getSiteSetting('theme_color_background'),
    ]);
    const c = emailPalette(primary, background);
    // brand_name and brand_tagline are admin-set and land in an alt attribute
    // and in body copy. The event templates interpolate them raw; escaping here
    // costs nothing and stops a stray quote breaking the markup.
    const esc = (v: string): string =>
      v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const brandEsc = esc(brand);
    const taglineEsc = esc((tagline ?? '').trim());

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${c.pageBg};font-family:'Helvetica Neue',Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" style="max-width:600px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.12)">
  <tr><td style="background:${c.band};padding:20px;text-align:center">
    <img src="${logoUrl}" alt="${brandEsc}" height="100" style="display:inline-block;height:100px" />
  </td></tr>
  <tr><td style="padding:32px 36px 24px;color:${c.inkMuted};font-size:0.95rem;line-height:1.6">
    ${html}
  </td></tr>
  ${
    taglineEsc
      ? `<tr><td style="padding:16px 36px;background:${c.surfaceAlt};border-top:1px solid ${c.rule};text-align:center">
    <p style="margin:0;font-size:0.78rem;color:#999">${brandEsc} — ${taglineEsc}</p>
  </td></tr>`
      : ''
  }
</table>
</td></tr>
</table>
</body>
</html>`;
  }

  /**
   * Whether the community this send belongs to is a demo, which may not mail
   * anyone (v2-14).
   *
   * **Omitting a demo's provider config would not have stopped it.** v2-9 made
   * the deployment's Brevo credentials the fallback for any community that has
   * none of its own, and a demo lives on a subdomain of the deployment, so
   * `isOnDeploymentDomain` is true for it and it inherits them. A blank config
   * therefore means "send on the operator's account", which is precisely the
   * outcome to prevent: anyone can create a demo, so anyone could mail arbitrary
   * addresses from the deployment's sending domain and spend its reputation.
   *
   * So the block is an explicit refusal keyed on the column, at the two entry
   * points every send passes through. The one mail a demo *causes* -- its
   * confirmation link -- is composed and sent in the ROOT tenant's context by
   * DemoService, which is why that one is unaffected by this.
   *
   * Reads the column directly rather than through TenantResolutionService to
   * avoid a module cycle; the query is on the send path, but a send already
   * costs a provider round trip.
   */
  private async sendingIsBlocked(recipient: string): Promise<boolean> {
    const tenantId = currentTenantId();
    if (!tenantId) return false;
    const tenant = await this.prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { isDemo: true },
    });
    if (!tenant?.isDemo) return false;
    this.logger.warn(
      `Refusing to send to ${recipient}: this is a demo community, which cannot send mail.`,
    );
    return true;
  }

  async queue(input: QueueEmailDto): Promise<EmailQueueRow | null> {
    if (await this.sendingIsBlocked(input.toEmail)) return null;
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
        // `other` rather than NULL for anything written from here on: NULL means
        // "this row predates the column", and conflating the two would make the
        // log's Unknown rows grow forever instead of shrinking.
        category: dto.category ?? EmailCategory.OTHER,
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
    // Blocked before branding, so a demo community never reaches the provider
    // even on the path that bypasses the queue. See sendingIsBlocked.
    if (await this.sendingIsBlocked(input.toEmail)) return;
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
      await this.recordImmediateSend(dto);
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

  /**
   * Writes an already-sent message into `email_queue` so the admin log shows it.
   *
   * **`email_queue` is the record of what a community sent, not just of what is
   * waiting to go** -- but `sendNow` talks to the provider directly and, until
   * this, wrote a row only when the send *failed* and fell back to the queue. So
   * every successful immediate send was invisible: password resets, address
   * verification, the lockout alert, two event mails, and v2-14's demo
   * confirmation. An operator reading the log saw a community that had
   * apparently never sent anything of consequence.
   *
   * Exactly the shape of the bug v2-9 fixed one layer over, where `sendNow`
   * bypassed `brevoSentToday` and resets went uncounted. The counter was fixed
   * then; nobody checked the log. Found by Rob on stage looking for the demo's
   * confirmation mail.
   *
   * The row is written with status `sent`, which the dispatcher ignores -- it
   * selects `PENDING` only -- so this records history without queuing work.
   *
   * Failures here are swallowed for the same reason `countImmediateSend`
   * swallows its own: the message has already gone, and losing its log entry is
   * much better than throwing on a caller who believes the send succeeded.
   */
  private async recordImmediateSend(dto: QueueEmailDto): Promise<void> {
    try {
      await this.prisma.email_queue.create({
        data: {
          toEmail: dto.toEmail,
          toName: dto.toName ?? null,
          subject: dto.subject,
          templateId: dto.templateId ?? null,
          category: dto.category ?? EmailCategory.OTHER,
          templateParams: (dto.templateParams as Prisma.InputJsonValue) ?? Prisma.DbNull,
          htmlBody: dto.htmlBody ?? null,
          textBody: dto.textBody ?? null,
          priority: dto.priority ?? 5,
          status: EmailQueueStatus.SENT,
          provider: EmailProvider.BREVO,
          attempts: 1,
          lastAttemptAt: new Date(),
          sentAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(`Could not log an immediate send: ${(err as Error).message}`);
    }
  }

  /**
   * The email log: everything this community has sent or tried to (v2-31).
   *
   * Replaces `getQueue`, which was `findMany({ orderBy: createdAt desc, take:
   * 100 })` — every status, which was right, but a hard cap of a hundred rows
   * with no search, which meant "did this member get their invite" stopped
   * being answerable after a day or two of real volume. That is the only
   * question this screen exists to answer.
   *
   * **Bodies and template params are deliberately not selected.** `html_body`
   * is LongText, so sending it for every row made the list heavy in proportion
   * to the mail rather than to the page, and nothing on the list renders it.
   * `getLogEntry` fetches them for the one row somebody expands. `hasContent`
   * is computed here so the UI can say whether expanding will show anything
   * without fetching it first.
   *
   * Pagination is offset-based rather than cursor-based: the screen has numbered
   * pages and a "jump to the end" affordance, which a cursor cannot express, and
   * the index added in this item makes the offset scan cheap enough at the
   * volumes a single community reaches.
   */
  async getLog(query: EmailLogQueryDto): Promise<EmailLogPage> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const where = this.buildLogWhere(query);

    // Counted in the same round trip. The total is what draws the paginator,
    // and fetching it separately would let the two disagree about a log that is
    // being written to while it is read.
    const [rows, total, byStatus] = await Promise.all([
      this.prisma.email_queue.findMany({
        where,
        // `id` is not decoration -- it is what makes paging correct.
        //
        // `created_at` is DATETIME(0), so it has whole-second precision, and a
        // fan-out writes one row per member inside a single second: an event
        // reminder to eighty people is eighty rows sharing a timestamp. Ordering
        // by that column alone leaves those ties in whatever order the engine
        // chooses, and an unstable order under OFFSET/LIMIT does not merely look
        // untidy -- a row can appear on two consecutive pages while another is
        // skipped entirely, so scanning the log after a bulk send silently
        // misses messages.
        //
        // `id` is unique and monotonic with insertion, so it makes the order
        // total. It costs nothing: InnoDB carries the primary key in every
        // secondary index, so `(tenant_id, created_at)` already sorts by id
        // within a timestamp.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          toEmail: true,
          toName: true,
          subject: true,
          templateId: true,
          category: true,
          status: true,
          provider: true,
          attempts: true,
          priority: true,
          lastAttemptAt: true,
          errorMessage: true,
          brevoStatus: true,
          sendAfter: true,
          sentAt: true,
          createdAt: true,
        },
      }),
      this.prisma.email_queue.count({ where }),
      // Unfiltered on purpose -- see `counts`. One grouped query, so it costs a
      // single index scan rather than one count per status.
      this.prisma.email_queue.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    // Recorded before the response is shaped, and never allowed to fail the
    // read: this is a statistic, and a screen that 500s because a counter could
    // not be written would be a poor trade for it.
    const oldest = rows.length > 0 ? rows[rows.length - 1].createdAt : null;
    await this.recordLogView(oldest);

    // No `hasContent` flag. Prisma cannot select "is this LongText column
    // non-empty" without reading it, and the honest alternatives were guessing
    // from `templateId` or sending the bodies after all. The detail fetch says
    // what is there, and the screen already has an empty state for a message
    // whose content was never stored -- a provider-template send stores none.
    return {
      rows,
      total,
      page,
      limit,
      pages: Math.max(1, Math.ceil(total / limit)),
      // Every status present as a key, including the ones with no rows, so the
      // screen can render "0 failed" rather than having to treat a missing key
      // as zero at each use.
      usage: await this.readLogUsage(),
      counts: Object.fromEntries([
        ...Object.values(EmailQueueStatus).map((status) => [status, 0]),
        ...byStatus.map((group) => [group.status, group._count._all]),
      ]) as Record<string, number>,
    };
  }

  /**
   * The heavy half of one log entry, fetched when a row is expanded.
   *
   * Separate from the list for the reason above: these three columns are most
   * of the table's bytes and none of its searchable surface. Scoped like every
   * other read here, so one community cannot fetch another's message by id --
   * the extension adds the predicate, and a wrong id reads as absent.
   */
  async getLogEntry(id: number): Promise<EmailLogContent | null> {
    const row = await this.prisma.email_queue.findFirst({
      where: { id },
      select: { id: true, templateParams: true, htmlBody: true, textBody: true },
    });
    return row ?? null;
  }

  /**
   * Shared by the page and its count, so the two cannot drift apart and report
   * a total that does not match the rows.
   */
  private buildLogWhere(query: EmailLogQueryDto): Prisma.email_queueWhereInput {
    const where: Prisma.email_queueWhereInput = {};

    if (query.status) where.status = query.status as EmailQueueStatus;
    if (query.category) where.category = query.category;

    if (query.q) {
      // The three fields somebody actually remembers. MySQL's collation is
      // case-insensitive, so no `mode: 'insensitive'` is needed -- and asking
      // for it on MySQL is an error rather than a no-op.
      where.OR = [
        { toEmail: { contains: query.q } },
        { toName: { contains: query.q } },
        { subject: { contains: query.q } },
      ];
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(query.from);
    // A bare `YYYY-MM-DD` parses as midnight, so an inclusive end date has to
    // reach the end of that day -- otherwise "to: today" returns nothing sent
    // today, which reads as a broken filter rather than an off-by-one.
    if (query.to) createdAt.lte = endOfDayIfDateOnly(query.to);
    if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

    return where;
  }



  /**
   * Notes that the log was read, and how far back the reader got.
   *
   * One row per community per day rather than one per request: the debounced
   * search fires on every pause in typing, so a request-level record would be
   * mostly noise, and the question this answers needs only daily granularity.
   *
   * **`deepest_age_days` is the column that matters.** "How often" says the
   * screen is used; how far back anybody actually reached is what says which
   * rows are safe to delete, which is the decision being deferred.
   *
   * Raw SQL for `ON DUPLICATE KEY UPDATE` with `GREATEST` -- Prisma's upsert
   * cannot express "keep the larger of the two" -- and it therefore carries its
   * own `tenant_id`, taken from `requireTenantId`, because raw SQL is not routed
   * through the scoping extension.
   *
   * Swallows its own errors. Nothing a reader does should fail because a
   * statistic could not be written.
   */
  private async recordLogView(oldestOnPage: Date | null): Promise<void> {
    try {
      const tenantId = requireTenantId('recording that the email log was reviewed');
      const now = new Date();
      // Whole days, floored. A message read the same day it was sent is 0, which
      // is the honest answer rather than 1.
      const ageDays = oldestOnPage
        ? Math.max(0, Math.floor((now.getTime() - oldestOnPage.getTime()) / 86_400_000))
        : 0;

      await this.prisma.$executeRaw`
        INSERT INTO email_log_views (tenant_id, viewed_on, views, deepest_age_days, last_viewed_at)
        VALUES (${tenantId}, CURDATE(), 1, ${ageDays}, ${now})
        ON DUPLICATE KEY UPDATE
          views = views + 1,
          deepest_age_days = GREATEST(deepest_age_days, ${ageDays}),
          last_viewed_at = ${now}
      `;
    } catch (err) {
      this.logger.warn(
        `Could not record an email log view: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * The usage summary shown under the log, so the retention decision can be
   * made from the screen rather than from a SQL prompt later.
   *
   * 90 days for "how often" because that is a long enough habit to read
   * something into, and all time for "how far back" because a single deep read
   * is exactly the evidence that would make a short retention wrong.
   */
  private async readLogUsage(): Promise<EmailLogUsage> {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const [recent, deepest] = await Promise.all([
      this.prisma.email_log_views.count({ where: { viewedOn: { gte: since } } }),
      this.prisma.email_log_views.aggregate({
        _max: { deepestAgeDays: true, lastViewedAt: true },
      }),
    ]);

    return {
      daysReviewed: recent,
      deepestAgeDays: deepest._max.deepestAgeDays ?? 0,
      lastReviewedAt: deepest._max.lastViewedAt ?? null,
    };
  }

  /**
   * Clears the rendered body of messages older than the retention window
   * (Rob, 2026-10-03).
   *
   * **The body goes; the row stays.** `html_body` is LongText and is most of
   * what this table weighs, while the envelope -- who, what subject, when, what
   * status -- is a few hundred bytes and is what the log is actually for.
   * Keeping the row means "did we ever send Dana her invite, back in March" is
   * still answerable a year later for almost nothing, while the part that costs
   * real storage is gone after a month.
   *
   * If rows should disappear entirely instead, that is one more `deleteMany`
   * here -- it was left out deliberately, because deleting the row destroys the
   * only record that a message was ever sent, and nothing in this table can be
   * reconstructed afterwards.
   *
   * Nothing prunes `email_queue` today, so this is the first thing that bounds
   * it at all.
   *
   * **`bodyClearedAt` is what makes this idempotent.** An empty body is
   * otherwise indistinguishable from a message that never had one -- a
   * provider-template send stores none -- so without the marker the sweep would
   * rewrite the same rows every night and report work it had not done.
   *
   * Pending and failed messages are left alone whatever their age: the
   * dispatcher still intends to send them, and clearing the body would turn a
   * retry into an empty email.
   */
  async clearOldBodies(
    now = new Date(),
    retentionDays = this.bodyRetentionDays,
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

    const { count } = await this.prisma.email_queue.updateMany({
      where: {
        createdAt: { lt: cutoff },
        bodyClearedAt: null,
        // Only messages whose journey is over.
        status: { in: [EmailQueueStatus.SENT, EmailQueueStatus.FAILED, EmailQueueStatus.CANCELLED] },
      },
      data: {
        htmlBody: null,
        textBody: null,
        templateParams: Prisma.DbNull,
        bodyClearedAt: now,
      },
    });
    return count;
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
