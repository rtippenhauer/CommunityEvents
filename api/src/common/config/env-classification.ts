/**
 * REQ-TENANT-01.4 -- bootstrap config vs. runtime config.
 *
 * The requirement is short and blunt: bootstrap config (env, set once at
 * container start) shrinks to the database connection, `DB_MODE` and
 * `ROOT_TENANT_URL`; everything else becomes tenant-aware runtime config. The
 * hard part is not moving any one setting, it is knowing which of the ~45
 * variables an operator can set is which -- so the classification is declared
 * here, once, rather than being re-derived from `.env.example` comments every
 * time somebody asks whether a value is per-deployment or per-community.
 *
 * `env-classification.spec.ts` asserts this list covers `.env.example` exactly,
 * so a new variable cannot be added to the sample env without being classified,
 * and a classification cannot outlive the variable it describes.
 *
 * This file is documentation that fails the build when it goes stale. Nothing
 * reads it at runtime -- deliberately. A lookup table that silently decided
 * where a value came from would be a worse version of ConfigService.
 */
export type EnvClass =
  /**
   * Genuinely bootstrap. Read before any tenant can be resolved -- because it
   * is how the process reaches the database, or how the root tenant is found in
   * it -- so it cannot itself live in the database. This is the set
   * REQ-TENANT-01.4 says should be small, and it is.
   */
  | 'bootstrap'
  /**
   * Read once by `bootstrap.ts` / `provision-tenant.ts` / `seed-test-data.ts`
   * and never by a request. These are install arguments, not configuration:
   * after the first run their value lives in the database and editing the env
   * changes nothing. They are not candidates for runtime config because there
   * is no runtime that reads them.
   */
  | 'install'
  /**
   * Deployment-wide runtime behaviour that is not per-community and should not
   * become so -- the process's own identity and limits. A second tenant does
   * not want its own port.
   */
  | 'deployment'
  /**
   * Superseded by tenant-aware `app_config`. The env var survives as the
   * deployment-wide default for tenants that have not set their own, which is
   * also what keeps existing installs working unchanged. New per-tenant values
   * are set through the admin settings UI, not here.
   */
  | 'runtime'
  /**
   * Holds a credential.
   *
   * This group used to be called `secret-pending-v2-7`, and the "pending" was
   * the point: there was nowhere in the database to put a secret, so every one
   * of them stayed in env whether or not that was the right home. v2-7 built
   * the encryption layer, which turns the question back into an ordinary one --
   * is this value per-community or per-deployment? -- answered per variable in
   * the notes below.
   *
   * Three of them now resolve per-community, from `tenant_secrets`, with the
   * env var surviving as the deployment-wide default. The rest stay in env for
   * reasons that are not about encryption: they belong to one deployment, or
   * their per-tenant home is a different column that a later item populates.
   *
   * The group keeps a name of its own rather than merging into `runtime`
   * because it still marks the values that must never be logged, echoed back
   * through an API, or written to a table without encryption.
   */
  | 'secret';

export interface EnvVarClassification {
  readonly cls: EnvClass;
  /** Why it is in that group, where the reason is not obvious from the name. */
  readonly note?: string;
}

export const ENV_CLASSIFICATION: Readonly<Record<string, EnvVarClassification>> = {
  // --- bootstrap -----------------------------------------------------------
  DB_HOST: { cls: 'bootstrap' },
  DB_PORT: { cls: 'bootstrap' },
  DB_NAME: { cls: 'bootstrap' },
  DB_USER: { cls: 'bootstrap' },
  DB_PASSWORD: { cls: 'bootstrap' },
  DB_ROOT_PASSWORD: {
    cls: 'bootstrap',
    note: 'Bundled-MySQL only. Consumed by docker-compose, never by the API.',
  },
  APP_URL: {
    cls: 'bootstrap',
    note:
      "The root tenant's domain defaults to this, so it is how the deployment " +
      'finds its own first tenant. Still legitimately deployment-wide for the ' +
      'OAuth callback registered with Google and the stage check; every ' +
      'member-facing link uses TenantResolutionService.baseUrlFor() instead.',
  },
  ROOT_TENANT_URL: {
    cls: 'bootstrap',
    note: 'Overrides APP_URL for the root tenant domain. Named by the requirement itself.',
  },
  JWT_SECRET: {
    cls: 'bootstrap',
    note:
      'Verifying a session token has to happen before the request is scoped, ' +
      'so this cannot come from a per-tenant table. Per-tenant signing keys ' +
      'would also mean a token could not be told apart from a forgery until ' +
      'after the tenant was resolved from it.',
  },
  SECRET_ENCRYPTION_KEY: {
    cls: 'bootstrap',
    note:
      'The key everything else in the "secret" group is encrypted under. It is ' +
      'the one variable that could not become runtime config even in ' +
      'principle: it is what makes runtime config readable, so storing it ' +
      'there is circular -- and for the same reason it is not in the database ' +
      'either, since a dump containing the key is a dump of the plaintext. ' +
      'Optional: a deployment with no key and no secrets generates its own on ' +
      'first start and writes it to SECRET_ENCRYPTION_KEY_FILE. Set this to ' +
      'override that, or to supply a key an existing database already needs.',
  },
  SECRET_ENCRYPTION_KEY_FILE: {
    cls: 'bootstrap',
    note:
      'Where a generated key is kept, defaulting to the persistent appdata ' +
      'volume so it survives a container rebuild. Only read when ' +
      'SECRET_ENCRYPTION_KEY is unset.',
  },
  SECRET_ENCRYPTION_KEYS_RETIRED: {
    cls: 'bootstrap',
    note:
      'Previous encryption keys, decrypt-only, comma-separated. Empty except ' +
      'during a rotation -- see rewrap-secrets.ts for the sequence.',
  },
  EMAIL_SUPPRESSION_SALT: {
    cls: 'bootstrap',
    note:
      'Salts the SHA-256 in email_suppressions. Rotating it orphans every ' +
      'existing hash, so it is fixed for the life of the database rather than ' +
      'editable anywhere.',
  },

  // --- install -------------------------------------------------------------
  ROOT_TENANT_SLUG: { cls: 'install' },
  AUTO_PROVISION: { cls: 'install' },
  ALLOW_TENANT_PROVISION: { cls: 'install' },
  ADMIN_EMAIL: { cls: 'install', note: "The first system admin's address." },
  INSTANCE_ADMIN_NAME: { cls: 'install' },
  INSTANCE_CITY_NAME: { cls: 'install' },
  INSTANCE_CITY_SUBDOMAIN: { cls: 'install' },
  INSTANCE_BRAND_NAME: { cls: 'install', note: 'Seeds the app_config row of the same name.' },
  INSTANCE_BRAND_TAGLINE: { cls: 'install', note: 'Seeds the app_config row of the same name.' },
  INSTANCE_THEME_PRIMARY: { cls: 'install', note: 'Seeds theme_color_primary.' },
  INSTANCE_THEME_ACCENT: { cls: 'install', note: 'Seeds theme_color_accent.' },
  INSTANCE_THEME_BACKGROUND: { cls: 'install', note: 'Seeds theme_color_background.' },
  INSTANCE_BOOTSTRAP_FORCE: { cls: 'install' },
  TENANT_DOMAIN: { cls: 'install', note: 'provision-tenant.ts argument.' },
  TENANT_SLUG: { cls: 'install', note: 'provision-tenant.ts argument.' },
  TENANT_STATUS: { cls: 'install', note: 'provision-tenant.ts argument.' },
  ALLOW_TEST_DATA: { cls: 'install' },
  TEST_DATA_TENANT: { cls: 'install' },
  TEST_MEMBER_COUNT: { cls: 'install' },
  TEST_MEMBER_CITY_ID: { cls: 'install' },
  TEST_MEMBER_EMAIL_PATTERN: { cls: 'install' },
  TEST_MEMBER_PASSWORD: { cls: 'install' },
  TEST_EVENT_COUNT: { cls: 'install' },

  // --- deployment ----------------------------------------------------------
  NODE_ENV: { cls: 'deployment' },
  PORT: { cls: 'deployment' },
  API_PORT: { cls: 'deployment' },
  FRONTEND_PORT: { cls: 'deployment' },
  UPLOAD_PATH: { cls: 'deployment' },
  RELEASE_NOTES_DIR: { cls: 'deployment' },
  GIT_COMMIT: { cls: 'deployment', note: 'Stamped by the image build.' },
  IS_STAGE: {
    cls: 'deployment',
    note:
      'A stage deployment is its own root tenant (REQ-TENANT-01.7), never a ' +
      'tenant of production, so this is a property of the whole process.',
  },
  TENANT_CACHE_TTL_MS: {
    cls: 'deployment',
    note: 'Tunes the resolver that runs before a tenant exists to ask.',
  },
  LEGAL_ENTITY_NAME: {
    cls: 'deployment',
    note:
      'Who operates the deployment, named in every community\'s seeded Terms ' +
      'and Privacy Policy. Deliberately not per-tenant: one operator runs them ' +
      'all, and a community cannot accurately describe processing it does not ' +
      'control. Blank falls back to the community\'s own name.',
  },
  JWT_EXPIRES_IN: {
    cls: 'deployment',
    note:
      'Paired with JWT_SECRET: session lifetime is decided when the token is ' +
      'signed, and a tenant cannot be allowed to extend its own.',
  },

  // --- runtime (tenant-aware app_config, env is the fallback) ---------------
  BASE_DOMAIN: {
    cls: 'runtime',
    note:
      'Mail domain, not the cookie scope (v2-6 made the session cookie ' +
      'host-only). Per-tenant override is the mail_domain app_config key. Not ' +
      "derived from the tenant's own host on purpose -- see AppConfigService.mailDomain().",
  },
  SUPPORT_EMAIL: { cls: 'runtime', note: 'Per-tenant override: contact_support_email.' },
  CALENDAR_ORGANIZER_EMAIL: {
    cls: 'runtime',
    note: 'Per-tenant override: contact_calendar_email.',
  },
  EVENT_ORGANIZER_EMAIL: { cls: 'runtime', note: 'Per-tenant override: contact_event_email.' },
  // The sending identity moves when the sending CREDENTIAL does, not before.
  // Both halves live in the global email_provider_config row, a provider
  // rejects a From address on a domain it has not verified, and every cron
  // send path would need auditing for tenant context first. So these are
  // per-tenant in principle and deployment-wide in practice until v2-7.
  BREVO_FROM_EMAIL: { cls: 'runtime', note: 'Deployment-wide until v2-7; see above.' },
  BREVO_FROM_NAME: { cls: 'runtime', note: 'Deployment-wide until v2-7; see above.' },
  RESEND_FROM_EMAIL: { cls: 'runtime', note: 'Deployment-wide until v2-7; see above.' },
  RESEND_FROM_NAME: { cls: 'runtime', note: 'Deployment-wide until v2-7; see above.' },
  GMAIL_FROM_EMAIL: { cls: 'runtime', note: 'Deployment-wide until v2-7; see above.' },
  GMAIL_FROM_NAME: { cls: 'runtime', note: 'Deployment-wide until v2-7; see above.' },
  GEOCODING_PROVIDER: { cls: 'runtime', note: 'Not a credential; the key beside it is.' },
  FACEBOOK_GROUP_1_CINCINNATI_ID: { cls: 'runtime', note: 'Display-only link, no API call.' },
  FACEBOOK_GROUP_1_DAYTON_ID: { cls: 'runtime', note: 'Display-only link, no API call.' },
  FACEBOOK_GROUP_2_DAYTON_ID: { cls: 'runtime', note: 'Display-only link, no API call.' },
  VAPID_SUBJECT: { cls: 'runtime', note: 'A contact mailto:, not a key.' },
  VAPID_PUBLIC_KEY: {
    cls: 'runtime',
    note: 'Public half -- already served to every browser in the branding payload.',
  },
  GOOGLE_CALLBACK_URL: {
    cls: 'runtime',
    note:
      'Per-tenant in principle, but pinned to one host in practice until ' +
      "v2-8's signed state handoff, because Google matches it exactly.",
  },
  FACEBOOK_CALLBACK_URL: { cls: 'runtime', note: 'As GOOGLE_CALLBACK_URL.' },
  BREVO_TEMPLATE_INVITE: {
    cls: 'runtime',
    note: 'Already DB-overridable via email_provider_config.',
  },
  BREVO_TEMPLATE_SECURITY_ALERT: { cls: 'runtime' },
  BREVO_TEMPLATE_EVENT_PUBLISHED: { cls: 'runtime' },
  BREVO_TEMPLATE_RSVP_CONFIRMATION: { cls: 'runtime' },
  BREVO_TEMPLATE_EVENT_REMINDER: { cls: 'runtime' },
  BREVO_TEMPLATE_ACCOUNT_DELETION: { cls: 'runtime' },
  BREVO_TEMPLATE_REENGAGEMENT_60: { cls: 'runtime' },
  BREVO_TEMPLATE_REENGAGEMENT_90: { cls: 'runtime' },
  BREVO_TEMPLATE_GUEST_RSVP_CONFIRMATION: { cls: 'runtime' },
  BREVO_TEMPLATE_EMAIL_VERIFICATION: { cls: 'runtime' },
  BREVO_TEMPLATE_PASSWORD_RESET: { cls: 'runtime' },

  // --- secret ---------------------------------------------------------------
  GOOGLE_CLIENT_ID: {
    cls: 'secret',
    note:
      'Not itself secret, but it is meaningless apart from the secret beside ' +
      'it -- the tenants table already has both columns reserved, and they ' +
      'move together in v2-8.',
  },
  GOOGLE_CLIENT_SECRET: {
    cls: 'secret',
    note:
      "Per-tenant, but its home is tenants.google_client_secret, which v2-8 " +
      'populates -- the column has been reserved and declared encrypted since ' +
      'v2-3. Two homes for one credential would be worse than a late one.',
  },
  FACEBOOK_APP_ID: { cls: 'secret', note: 'As GOOGLE_CLIENT_ID.' },
  FACEBOOK_APP_SECRET: { cls: 'secret', note: 'As GOOGLE_CLIENT_SECRET.' },
  BREVO_API_KEY: {
    cls: 'secret',
    note:
      'Per-community as of v2-9 (email_provider_config.brevoApiKey, encrypted ' +
      'since v2-7). This survives as the deployment-wide default, which is what ' +
      'keeps a community that has set none sending exactly as it did before.',
  },
  BREVO_WEBHOOK_SECRET: {
    cls: 'secret',
    note:
      'Superseded by a per-community token as of v2-9, and kept only as a ' +
      'fallback. The deployment no longer authenticates callbacks with this: ' +
      'each community has its own token, minted here, handed to Brevo through ' +
      'their API and rotated monthly -- so there is nothing for an operator to ' +
      'set. What this still does is honour webhooks registered BEFORE v2-9, ' +
      'which carry it in the query string, until each community re-registers. ' +
      'Removable once none does; losing bounce events in the meantime is the ' +
      'outcome worth avoiding, since a bounce that never arrives is an address ' +
      'the deployment keeps mailing. Note the handler stays runUnscoped either ' +
      'way -- a bounce is a property of the address, not of whichever community ' +
      'happened to send the message.',
  },
  RESEND_API_KEY: { cls: 'secret', note: 'As BREVO_API_KEY.' },
  GMAIL_USER: {
    cls: 'secret',
    note:
      'Read by nothing. A v1 SMTP fallback that no longer has code behind it ' +
      '-- kept documented only so the sample env and this list agree. Delete ' +
      'both when the Gmail path is formally dropped.',
  },
  GMAIL_APP_PASSWORD: { cls: 'secret', note: 'As GMAIL_USER: read by nothing.' },
  VAPID_PRIVATE_KEY: {
    cls: 'secret',
    note:
      'Half of a keypair whose public half is already held by every browser ' +
      'that has subscribed to push. A per-tenant value would invalidate those ' +
      'subscriptions with nothing able to re-establish them, so the keypair ' +
      'belongs to the deployment until something can re-subscribe.',
  },
  GEOCODING_API_KEY: {
    cls: 'secret',
    note:
      'Per-community as of v2-7 (tenant_secrets.geocoding_api_key); this ' +
      'remains the deployment-wide default. Metered against whoever owns the ' +
      'key, which is the case for letting a community supply its own.',
  },
  GOOGLE_PLACES_API_KEY: { cls: 'secret', note: 'As GEOCODING_API_KEY (places_api_key).' },
  ANTHROPIC_API_KEY: { cls: 'secret', note: 'As GEOCODING_API_KEY (anthropic_api_key).' },
  CLOUDFLARE_EMAIL_SECRET: {
    cls: 'secret',
    note: 'Authenticates one worker calling one endpoint. Deployment-wide by construction.',
  },
  CLAUDE_AUTOMATION_SECRET: {
    cls: 'secret',
    note:
      'Deliberately platform-wide: automationLogin only ever ' +
      "admits the root tenant's service account, so a per-tenant copy would " +
      'be a credential with nothing to open.',
  },
};

/** Every variable in a given group, sorted -- used by the spec and by docs. */
export function envVarsIn(cls: EnvClass): string[] {
  return Object.entries(ENV_CLASSIFICATION)
    .filter(([, v]) => v.cls === cls)
    .map(([k]) => k)
    .sort();
}
