import type { email_provider_config as EmailProviderConfig } from '@prisma/client';
import { EMAIL_PROVIDER_DEFAULTS } from '../../common/email/email-config-defaults';
import { quotaDayStart } from '../../common/email/quota-day';

/**
 * The email provider config as the admin screen is allowed to see it (v2-7).
 *
 * Every stored secret is replaced by a boolean saying whether one exists. They
 * are encrypted at rest now, and the Prisma extension hands services the
 * plaintext — which means the admin endpoint would otherwise decrypt an
 * operator's credentials and send them to a browser on every page load, undoing
 * at the last hop what the column encryption just achieved. A credential in a
 * response is a credential in an access log, a proxy buffer and a browser
 * cache.
 *
 * Nothing is lost: an admin who can set a key does not need to read it back,
 * and "is one configured" is the only thing the screen actually renders.
 *
 * **This is a deny-list over the row, so it is stated field by field rather
 * than by spreading `...rest`.** A spread was what this file used to do, and it
 * meant v2-9's webhook token — added to the same table months later — would have
 * been published to the browser by a file nobody thought to revisit. Adding a
 * secret column now requires deciding what the screen sees.
 *
 * The write direction is unchanged and needs no masking — a PATCH that omits a
 * key leaves it alone (the field is optional), and one that sends null clears
 * it.
 */
export type EmailConfigView = Omit<
  EmailProviderConfig,
  'brevoApiKey' | 'resendApiKey' | 'webhookSecret' | 'webhookSecretPrevious' | 'webhookId'
> & {
  readonly brevoApiKeySet: boolean;
  readonly resendApiKeySet: boolean;
  /** Whether Brevo currently holds a webhook pointing at this community. */
  readonly webhookRegistered: boolean;
};

/**
 * What a community that has never configured email looks like.
 *
 * Its settings are real even with no row: it sends on the deployment's env
 * credentials, against these limits, having sent nothing of its own. Returning
 * this rather than `null` is not cosmetic — the admin screen renders nothing at
 * all without a config, so a community with no row got a permanent spinner on
 * the one screen that could have created it. The row is still written on first
 * save, not on read; a GET must not write.
 *
 * `id: 0` says "not persisted yet". Nothing keys off it, and a real row's id is
 * never 0.
 */
function unconfigured(tenantId: number, timeZone: string): EmailProviderConfig {
  return {
    id: 0,
    tenantId,
    ...EMAIL_PROVIDER_DEFAULTS,
    brevoApiKey: null,
    brevoFromEmail: null,
    brevoFromName: null,
    resendApiKey: null,
    resendFromEmail: null,
    resendFromName: null,
    tmplInvite: null,
    tmplSecurityAlert: null,
    tmplEventPublished: null,
    tmplRsvpConfirmation: null,
    tmplEventReminder: null,
    tmplAccountDeletion: null,
    tmplReengagement60: null,
    tmplReengagement90: null,
    tmplGuestRsvpConfirmation: null,
    tmplEmailVerification: null,
    tmplPasswordReset: null,
    tmplProviderDisconnected: null,
    tmplAccountDeleted: null,
    // The window it would be counting in, not the instant it was asked. A
    // community with no row has sent nothing all window, not since now.
    lastResetDate: quotaDayStart(new Date(), timeZone),
    updatedAt: new Date(),
    webhookSecret: null,
    webhookSecretPrevious: null,
    webhookRotatedAt: null,
    webhookError: null,
    webhookId: null,
    brevoApiKeySetAt: null,
    lastSuccessfulSendAt: null,
  };
}

/**
 * The row as it is true *now*, with a lapsed sending window rolled forward.
 *
 * The stored counters are a ledger: they only advance when something sends,
 * because that is the only moment the deployment has reason to write them. So a
 * community that has sent nothing since yesterday still holds yesterday's
 * window and yesterday's count, and reading the row straight out reports both
 * as though they were current.
 *
 * That is not cosmetic. The date being wrong is merely confusing -- it showed a
 * window that opened two days ago -- but the count beside it is an allowance
 * reported as spent when the provider has since reset it, which is the opposite
 * of the error this whole counter exists to prevent.
 *
 * Derived rather than written, because **a GET must not write**: the rule this
 * screen already follows for creating the row, and for the same reason. The
 * dispatcher and `sendNow` still perform the real, persisted rollover when they
 * next act; until then nothing has been sent in this window, and reporting zero
 * is simply true.
 */
export function rollForwardWindow(
  config: EmailProviderConfig,
  timeZone: string,
): EmailProviderConfig {
  const windowStart = quotaDayStart(new Date(), timeZone);
  if (config.lastResetDate.getTime() >= windowStart.getTime()) return config;

  return {
    ...config,
    brevoSentToday: 0,
    resendSentToday: 0,
    lastResetDate: windowStart,
  };
}

/** This community's effective email settings, whether or not a row exists. */
export function effectiveEmailConfigView(
  config: EmailProviderConfig | null,
  tenantId: number,
  timeZone: string,
): EmailConfigView {
  return toEmailConfigView(
    config ? rollForwardWindow(config, timeZone) : unconfigured(tenantId, timeZone),
  );
}

export function toEmailConfigView(config: EmailProviderConfig): EmailConfigView {
  const {
    brevoApiKey,
    resendApiKey,
    // Pulled out of `rest` so they cannot reach a browser, and named with the
    // underscore the lint rule wants for a binding that exists only to be
    // discarded.
    webhookSecret: _webhookSecret,
    webhookSecretPrevious: _webhookSecretPrevious,
    webhookId,
    ...rest
  } = config;
  return {
    ...rest,
    brevoApiKeySet: Boolean(brevoApiKey),
    resendApiKeySet: Boolean(resendApiKey),
    // The id is Brevo's, not a secret — it is left out because the screen has
    // no use for it, and "is it registered" is the question it asks.
    webhookRegistered: Boolean(webhookId),
  };
}

/**
 * The sending window, and what the provider itself says about it.
 *
 * Deliberately a separate response from the config above, fetched separately by
 * the screen. It makes an outbound call to Brevo, and a settings page must not
 * be held up -- or emptied -- by a provider that is slow or down.
 *
 * The two numbers are different kinds of thing and are shown as such: ours is
 * what this deployment recorded sending, theirs is what they will actually cut
 * off on. They agreeing is the point; them disagreeing is the thing worth
 * seeing.
 */
export interface EmailQuotaWindowView {
  /** IANA zone the daily allowance is counted in (`EMAIL_QUOTA_TIMEZONE`). */
  readonly timeZone: string;
  /** When the current window opened. */
  readonly windowStartedAt: string;
  /** When it closes and the counters go back to zero. */
  readonly windowEndsAt: string;
  /**
   * Brevo's own figure, or null when there is no key, the call failed, or the
   * account is on a plan whose credits are not a daily allowance.
   */
  readonly providerRemaining: number | null;
  /** Brevo's plan naming, for the cases where the number is not comparable. */
  readonly providerPlan: string | null;
  /**
   * Brevo's account id. The allowance belongs to the account, not to this
   * community, and two communities sending on the same key are spending the
   * same number -- which is worth being able to see rather than infer.
   */
  readonly providerAccountId: string | null;
  /** When the figure was read, since it is cached rather than live per call. */
  readonly providerCheckedAt: string | null;
}
