import type { email_provider_config as EmailProviderConfig } from '@prisma/client';

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
