import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { email_provider_config as EmailProviderConfig } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { EmailTemplateName } from './email.constants';

export interface EmailAttachment {
  content: string;
  name: string;
  contentType?: string;
}

/**
 * Brevo's own view of what is left, which is a property of the ACCOUNT.
 *
 * This is the distinction that matters for a multi-community deployment. A
 * community that has not set its own key sends on the deployment's, so several
 * communities routinely share one Brevo account -- and the daily allowance they
 * are spending is one allowance, not one each. Two communities on a 300/day
 * account, each counting only its own sends against its own limit of 300, will
 * happily send 350 between them and be cut off having never once exceeded what
 * either believed was its budget.
 *
 * So the budget is tracked per account and the per-community counter stays what
 * it says it is: what that community sent. Two numbers, because they answer two
 * questions -- "how much has this community used" and "how much is left to
 * spend" -- and only the second one decides whether a message goes out.
 */
export interface BrevoAccountQuota {
  /** Credits Brevo reports remaining, for the whole account. */
  remaining: number;
  /** `free`, `payAsYouGo`, `subscription` -- Brevo's own plan naming. */
  planType: string;
  /**
   * Whether `remaining` is a DAILY allowance, and so something to hold sending
   * against. True only for a free plan; a prepaid balance has no daily cap, and
   * treating it as one would stop sending at an imaginary line.
   */
  isDailyAllowance: boolean;
  /**
   * Brevo's own account identifier. Not used as the cache key -- the key
   * fingerprint is, since it is known before the call -- but it is what lets
   * the admin screen say two communities are spending the same allowance, which
   * is otherwise invisible.
   */
  organizationId: string | null;
  /** When this was fetched, so a caller can say how fresh the number is. */
  fetchedAt: number;
}

export interface BrevoSendPayload {
  toEmail: string;
  toName?: string | null;
  subject: string;
  templateName?: EmailTemplateName;
  templateParams?: Record<string, unknown>;
  htmlBody?: string | null;
  textBody?: string | null;
  attachments?: EmailAttachment[];
}

const TEMPLATE_DB_KEY: Record<EmailTemplateName, keyof EmailProviderConfig> = {
  invite: 'tmplInvite',
  security_alert: 'tmplSecurityAlert',
  event_published: 'tmplEventPublished',
  rsvp_confirmation: 'tmplRsvpConfirmation',
  event_reminder: 'tmplEventReminder',
  account_deletion_warning: 'tmplAccountDeletion',
  reengagement_60: 'tmplReengagement60',
  reengagement_90: 'tmplReengagement90',
  guest_rsvp_confirmation: 'tmplGuestRsvpConfirmation',
  email_verification: 'tmplEmailVerification',
  password_reset: 'tmplPasswordReset',
  provider_disconnected: 'tmplProviderDisconnected',
  account_deleted: 'tmplAccountDeleted',
};

const TEMPLATE_ENV_KEY: Record<EmailTemplateName, string> = {
  invite: 'BREVO_TEMPLATE_INVITE',
  security_alert: 'BREVO_TEMPLATE_SECURITY_ALERT',
  event_published: 'BREVO_TEMPLATE_EVENT_PUBLISHED',
  rsvp_confirmation: 'BREVO_TEMPLATE_RSVP_CONFIRMATION',
  event_reminder: 'BREVO_TEMPLATE_EVENT_REMINDER',
  account_deletion_warning: 'BREVO_TEMPLATE_ACCOUNT_DELETION',
  reengagement_60: 'BREVO_TEMPLATE_REENGAGEMENT_60',
  reengagement_90: 'BREVO_TEMPLATE_REENGAGEMENT_90',
  guest_rsvp_confirmation: 'BREVO_TEMPLATE_GUEST_RSVP_CONFIRMATION',
  email_verification: 'BREVO_TEMPLATE_EMAIL_VERIFICATION',
  password_reset: 'BREVO_TEMPLATE_PASSWORD_RESET',
  provider_disconnected: 'BREVO_TEMPLATE_PROVIDER_DISCONNECTED',
  account_deleted: 'BREVO_TEMPLATE_ACCOUNT_DELETED',
};

@Injectable()
export class BrevoService {
  private readonly logger = new Logger(BrevoService.name);

  /**
   * The shortest a cached budget may be considered current.
   *
   * The refresh policy is demand-driven -- before a batch, after a send, on a
   * page load -- rather than scheduled, because those are the only moments the
   * number changes anything. This floor exists purely so that a burst of them
   * (a queue flush, or somebody leaning on refresh) cannot turn into a burst of
   * calls to Brevo and a rate limit.
   */
  private static readonly BUDGET_FLOOR_TTL_MS = 20_000;

  /** Cached account budgets, keyed by a hash of the API key that read them. */
  private readonly budgetCache = new Map<string, BrevoAccountQuota>();

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * This community's provider settings, falling back to the deployment's env.
   *
   * `findFirst` with no `where`, not `findUnique({ id: 1 })` -- as of v2-9 the
   * row is per-community and the extension supplies the tenant. Asking for id 1
   * would ask for the root community's row and, from anywhere else, correctly
   * return nothing.
   */
  private async getEffectiveConfig(): Promise<{ apiKey: string; fromEmail: string; fromName: string }> {
    const db = await this.prisma.email_provider_config.findFirst();
    return {
      apiKey: db?.brevoApiKey || this.config.get<string>('BREVO_API_KEY', ''),
      fromEmail: db?.brevoFromEmail || this.config.get<string>('BREVO_FROM_EMAIL', 'noreply@communityeventsproject.com'),
      fromName: db?.brevoFromName || this.config.get<string>('BREVO_FROM_NAME', 'CommunityEvents'),
    };
  }

  private async getTemplateId(templateName: EmailTemplateName): Promise<number> {
    const db = await this.prisma.email_provider_config.findFirst();
    const dbKey = TEMPLATE_DB_KEY[templateName];
    const dbValue = db ? (db[dbKey] as number | null) : null;
    if (dbValue && dbValue > 0) return dbValue;

    const envKey = TEMPLATE_ENV_KEY[templateName];
    return parseInt(this.config.get<string>(envKey, '0'), 10);
  }

  async isConfigured(): Promise<boolean> {
    const { apiKey } = await this.getEffectiveConfig();
    return apiKey.length > 0;
  }

  /**
   * What Brevo itself says is left of this community's daily allowance.
   *
   * The counters in `email_provider_config` are our own tally, and a tally can
   * drift from the thing it is tallying: mail sent from another application on
   * the same Brevo account, a send this deployment made and failed to record, a
   * day boundary drawn in the wrong zone. This is the authoritative number, and
   * asking for it beats modelling the provider's clock.
   *
   * `plan[]` is a list, and only some of it is a daily allowance. A free plan's
   * `sendLimit` credits are the sends remaining today -- it resets daily and
   * does not roll over. A pay-as-you-go or subscription balance is prepaid
   * credit with no daily cap, and treating that as "remaining today" would put
   * a five-figure number where a three-figure one belongs. So the plan type
   * travels with the number and the caller decides: only `isDailyAllowance` may
   * be reconciled against `brevoSentToday`.
   *
   * Never throws. This is a cross-check, and a provider outage must not take
   * down the screen showing it or the dispatcher consulting it.
   */
  async getAccountQuota(options: { maxAgeMs?: number } = {}): Promise<BrevoAccountQuota | null> {
    const { apiKey } = await this.getEffectiveConfig();
    if (!apiKey) return null;

    // Keyed by a fingerprint of the API key rather than by tenant, because the
    // account is the thing being described: two communities on one key share a
    // cache entry because they genuinely share the allowance. Two different
    // keys on the same account get an entry each and one extra call, and both
    // read the same account-wide number -- correct, just not deduplicated.
    //
    // Hashed because this lives in a map that may be dumped in a heap snapshot
    // or a debugger, and the key itself is a credential.
    const cacheKey = createHash('sha256').update(apiKey).digest('hex');
    const maxAgeMs = Math.max(options.maxAgeMs ?? BrevoService.BUDGET_FLOOR_TTL_MS,
      BrevoService.BUDGET_FLOOR_TTL_MS);
    const cached = this.budgetCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < maxAgeMs) return cached;

    try {
      const response = await fetch('https://api.brevo.com/v3/account', {
        headers: { 'api-key': apiKey, Accept: 'application/json' },
      });
      if (!response.ok) {
        this.logger.warn(`Brevo account lookup failed: ${response.status}`);
        return null;
      }

      const data = (await response.json()) as {
        organization_id?: string | number;
        plan?: { type?: string; creditsType?: string; credits?: number }[];
      };
      // SMS credits share the `sendLimit` type and are not email at all.
      const emailPlan = data.plan?.find(
        (entry) => entry.creditsType === 'sendLimit' && entry.type !== 'sms',
      );
      if (!emailPlan || typeof emailPlan.credits !== 'number') return null;

      const quota: BrevoAccountQuota = {
        remaining: Math.max(0, Math.floor(emailPlan.credits)),
        planType: emailPlan.type ?? 'unknown',
        isDailyAllowance: emailPlan.type === 'free',
        organizationId:
          data.organization_id === undefined ? null : String(data.organization_id),
        fetchedAt: Date.now(),
      };
      this.budgetCache.set(cacheKey, quota);
      return quota;
    } catch (err) {
      this.logger.warn(`Brevo account lookup failed: ${(err as Error).message}`);
      // Deliberately returns the stale entry rather than nothing. A number from
      // a minute ago is a far better basis for "may I send" than no number at
      // all, which reads as "no daily cap known" and lets everything through.
      return this.budgetCache.get(cacheKey) ?? null;
    }
  }

  /**
   * Drops the cached budget so the next read goes to Brevo.
   *
   * Used after a send, where the number we hold is known to be one out of date
   * and the next question anyone asks deserves a fresh answer.
   */
  async invalidateAccountQuota(): Promise<void> {
    const { apiKey } = await this.getEffectiveConfig();
    if (!apiKey) return;
    this.budgetCache.delete(createHash('sha256').update(apiKey).digest('hex'));
  }

  async send(payload: BrevoSendPayload): Promise<void> {
    const { apiKey, fromEmail, fromName } = await this.getEffectiveConfig();

    if (!apiKey) {
      this.logger.warn(`Brevo not configured — skipping email to ${payload.toEmail}`);
      return;
    }

    const body: Record<string, unknown> = {
      sender: { email: fromEmail, name: fromName },
      to: [{ email: payload.toEmail, name: payload.toName ?? payload.toEmail }],
      subject: payload.subject,
    };

    if (payload.templateName) {
      const templateId = await this.getTemplateId(payload.templateName);
      if (templateId > 0) {
        body['templateId'] = templateId;
        body['params'] = payload.templateParams ?? {};
      } else {
        this.logger.warn(`No Brevo template ID for ${payload.templateName}`);
        if (payload.htmlBody) body['htmlContent'] = payload.htmlBody;
        if (payload.textBody) body['textContent'] = payload.textBody;
      }
    } else {
      if (payload.htmlBody) body['htmlContent'] = payload.htmlBody;
      if (payload.textBody) body['textContent'] = payload.textBody;
    }

    if (payload.attachments?.length) {
      body['attachment'] = payload.attachments.map((a) => ({
        content: Buffer.from(a.content, 'utf-8').toString('base64'),
        name: a.name,
      }));
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Brevo API error ${response.status}: ${text}`);
    }
  }

  async isSuppressed(email: string): Promise<boolean> {
    const { apiKey } = await this.getEffectiveConfig();
    if (!apiKey) return false;

    const url = `https://api.brevo.com/v3/contacts/blockedContacts?email=${encodeURIComponent(email)}`;
    const response = await fetch(url, {
      headers: { 'api-key': apiKey, Accept: 'application/json' },
    });

    if (response.status === 404) return false;
    if (!response.ok) return false;

    const data = (await response.json()) as { count?: number };
    return (data.count ?? 0) > 0;
  }

  async removeFromSuppressionList(email: string): Promise<void> {
    const { apiKey } = await this.getEffectiveConfig();
    if (!apiKey) return;

    const response = await fetch(
      `https://api.brevo.com/v3/contacts/blockedContacts/${encodeURIComponent(email)}`,
      {
        method: 'DELETE',
        headers: { 'api-key': apiKey },
      },
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to remove ${email} from Brevo suppression list`);
    }
  }
}
