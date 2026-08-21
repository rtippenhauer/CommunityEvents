import type { email_provider_config as EmailProviderConfig } from '@prisma/client';

/**
 * The email provider config as the admin screen is allowed to see it (v2-7).
 *
 * The two API keys are replaced by booleans saying whether one is stored. They
 * are encrypted at rest now, and the Prisma extension hands services the
 * plaintext — which means the admin endpoint would otherwise decrypt an
 * operator's Brevo key and send it to a browser on every page load, undoing at
 * the last hop what the column encryption just achieved. A credential in a
 * response is a credential in an access log, a proxy buffer and a browser
 * cache.
 *
 * Nothing is lost: an admin who can set a key does not need to read it back,
 * and "is one configured" is the only thing the screen actually renders.
 *
 * The write direction is unchanged and needs no masking — a PATCH that omits a
 * key leaves it alone (the field is optional), and one that sends null clears
 * it.
 */
export type EmailConfigView = Omit<EmailProviderConfig, 'brevoApiKey' | 'resendApiKey'> & {
  readonly brevoApiKeySet: boolean;
  readonly resendApiKeySet: boolean;
};

export function toEmailConfigView(config: EmailProviderConfig): EmailConfigView {
  const { brevoApiKey, resendApiKey, ...rest } = config;
  return {
    ...rest,
    brevoApiKeySet: Boolean(brevoApiKey),
    resendApiKeySet: Boolean(resendApiKey),
  };
}
