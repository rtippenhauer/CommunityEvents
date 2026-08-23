/**
 * The per-community credentials a tenant may hold (v2-7).
 *
 * These are the variables `env-classification.ts` grouped as secrets that
 * *would* be per-tenant runtime config if a plaintext `app_config` row had been
 * an acceptable home for them. It was not, which is what blocked them on this
 * item; now that ciphertext has a home they resolve like every other piece of
 * runtime config, most-specific-first:
 *
 *   1. the community's own `tenant_secrets` row, if it has set one;
 *   2. otherwise the deployment-wide env var named below.
 *
 * So an install that sets nothing behaves exactly as it did before this list
 * existed, and only a community that supplies its own key diverges — the same
 * bargain the contact-address settings struck in v2-6.
 *
 * ## Why these three and not the other twelve
 *
 * Each of these bills someone. Geocoding, Places and Anthropic calls are
 * metered against whoever owns the key, so a single platform-wide key means the
 * operator pays for every community's usage out of one quota that any one of
 * them can exhaust. That is the case for per-community credentials, and it is
 * why the classification called them per-tenant in the first place.
 *
 * The rest of the secret group stays in env, for reasons that differ in kind —
 * some structural, where the value belongs to the deployment and always
 * will; some only until the item that gives them a per-community home, which
 * is not this one. Which is which matters more than the split:
 *
 *  - `GOOGLE_CLIENT_*` / `FACEBOOK_APP_*` are per-tenant, but their home is the
 *    reserved `tenants` columns, which v2-8 populates. Two homes for one
 *    credential would be worse than a late one.
 *  - `BREVO_API_KEY` / `RESEND_API_KEY` / `BREVO_WEBHOOK_SECRET` are all three
 *    per-community *in principle* -- the webhook secret included, since it
 *    authenticates callbacks from a particular Brevo account and a community
 *    with its own account has its own. They are here because `email_provider_config`
 *    is still one global row and one sending identity, not because any of them
 *    belongs to the deployment by nature. Per-community sending is a real
 *    future item and a larger one than a key: a provider rejects a From address
 *    on a domain it has not verified, so it needs a verified-domain flow rather
 *    than a text field, and all three move together when it lands.
 *  - `VAPID_PRIVATE_KEY` is half of a keypair whose public half is already held
 *    by every browser that has subscribed to push. Changing it per tenant
 *    invalidates those subscriptions with no way to re-establish them, so the
 *    keypair belongs to the deployment until something can re-subscribe.
 *  - `GMAIL_USER` / `GMAIL_APP_PASSWORD` are neither: nothing reads them. A v1
 *    SMTP fallback whose code is gone, still named in `.env.example` and the
 *    compose files. Delete all three references together, not just this one.
 *  - `CLOUDFLARE_EMAIL_SECRET` authenticates one worker calling one endpoint,
 *    and `CLAUDE_AUTOMATION_SECRET` only ever opens the root tenant's service
 *    account — a per-community copy would be a credential with nothing to open.
 */

export const TENANT_SECRET_KEYS = [
  'geocoding_api_key',
  'places_api_key',
  'anthropic_api_key',
] as const;

export type TenantSecretKey = (typeof TENANT_SECRET_KEYS)[number];

/**
 * The deployment-wide default for each key.
 *
 * Kept as an explicit map rather than derived from the key name: the env names
 * are inherited from v1 and do not follow one rule (`GEOCODING_API_KEY` but
 * `GOOGLE_PLACES_API_KEY`), and a derivation that happened to work for three
 * names would break silently on the fourth.
 */
export const TENANT_SECRET_ENV_FALLBACK: Readonly<Record<TenantSecretKey, string>> = {
  geocoding_api_key: 'GEOCODING_API_KEY',
  places_api_key: 'GOOGLE_PLACES_API_KEY',
  anthropic_api_key: 'ANTHROPIC_API_KEY',
};

/**
 * Human-readable labels, for the admin API's listing.
 *
 * The listing reports which keys exist and where each is currently resolving
 * from — never a value — so it needs something to call them that is not the
 * column name.
 */
export const TENANT_SECRET_LABELS: Readonly<Record<TenantSecretKey, string>> = {
  geocoding_api_key: 'Google Geocoding API key',
  places_api_key: 'Google Places API key',
  anthropic_api_key: 'Anthropic API key',
};

const LOOKUP: ReadonlySet<string> = new Set(TENANT_SECRET_KEYS);

/**
 * Narrows an arbitrary string from a request path to a known key.
 *
 * An unknown key is rejected at the controller rather than written and ignored:
 * `tenant_secrets` tolerates a stray row by design (so a downgrade loses
 * nothing), and that tolerance would otherwise turn a typo in a key name into a
 * setting that saves, reads back as saved, and does nothing.
 */
export function isTenantSecretKey(key: string): key is TenantSecretKey {
  return LOOKUP.has(key);
}
