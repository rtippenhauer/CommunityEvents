import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { app_config as AppConfig } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
// Aliased: the methods below have the same names, and an unqualified
// `supportEmail(...)` inside `async supportEmail()` reads like recursion.
// The env prefix also says which layer is being reached for at each site.
import {
  baseDomain,
  calendarOrganizerEmail as envCalendarOrganizerEmail,
  eventOrganizerEmail as envEventOrganizerEmail,
  supportEmail as envSupportEmail,
} from '../../common/config/instance-contact';
import { currentTenantId, requireTenantId, runWithTenant } from '../../common/tenant/tenant-store';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';

// Only these keys are servable/editable through the config endpoints — keeps
// this generic key/value table from becoming an accidental back door into
// unrelated app_config rows (invite expiry windows, inactivity thresholds,
// etc.) that this admin editor was never meant to manage.
export const LEGAL_CONFIG_KEYS = [
  'legal_terms_html',
  'legal_privacy_html',
  'about_story_html',
  // Home-page hero copy (the rich-text block beside the calendar/events). Edited
  // in the same admin rich-text editor; empty falls back to a generic branded hero.
  'home_hero_html',
  // Home-page "How it works" block. Editable rich text; empty = section hidden.
  'home_howitworks_html',
] as const;
export type LegalConfigKey = (typeof LEGAL_CONFIG_KEYS)[number];

function isLegalConfigKey(key: string): key is LegalConfigKey {
  return (LEGAL_CONFIG_KEYS as readonly string[]).includes(key);
}

// Small operational settings — not secrets, so readable through the same
// public /config/:key endpoint as legal copy, but only editable by admins.
export const SITE_SETTING_KEYS = [
  'location_privacy_default',
  'event_cadence_weekday',
  'event_cadence_time',
  'home_show_stats',
  'brand_name',
  'brand_tagline',
  'theme_color_primary',
  'theme_color_accent',
  'theme_color_background',
  'brand_logo_url',
  'brand_splash_url',
  'brand_icon_url',
  'brand_story_url',
  // Contact identity, per community (REQ-TENANT-01.4). Empty means "inherit the
  // deployment default", which is the matching env var or, failing that, a
  // derivation from the mail domain -- so an existing install behaves exactly
  // as it did before these keys existed, and only a community that sets one
  // diverges. See mailDomain() for why the tenant's own host is NOT the
  // default here.
  'mail_domain',
  'contact_support_email',
  'contact_calendar_email',
  'contact_event_email',
  // Configurable per-instance terminology (Phase 32). Singular + plural stored
  // separately rather than derived (naive "+s" pluralization is unreliable), so
  // a fork can set e.g. Location/Locations, Meeting/Meetings. Points is a single
  // label since it never appears pluralized differently.
  'term_location_singular',
  'term_location_plural',
  'term_dinner_singular',
  'term_dinner_plural',
  'term_points',
  // Per-instance feature toggles (Phase 33). Stored as 'true'/'false'; all
  // default 'true' so nothing is disabled unless an admin turns it off.
  'feature_ratings',
  'feature_ratings_residences',
  'feature_leaderboard',
  'feature_merch',
  'feature_members',
  // Membership fee (Phase 35). Off by default — a brand-new concept nothing
  // depends on, unlike the Phase 33 toggles which defaulted on for
  // backward-compat.
  'feature_require_membership',
] as const;
export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[number];

// The subset of SITE_SETTING_KEYS that are boolean feature toggles. Kept
// separate so the admin UI can render them as switches (not text fields) and
// the branding endpoint can surface them as a typed `features` map.
export const FEATURE_KEYS = [
  'feature_ratings',
  'feature_ratings_residences',
  'feature_leaderboard',
  'feature_merch',
  'feature_members',
  'feature_require_membership',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

// Camel-cased feature map surfaced on /config/branding for the frontend.
export interface FeatureFlags {
  ratings: boolean;
  ratingsResidences: boolean;
  leaderboard: boolean;
  merch: boolean;
  members: boolean;
  requireMembership: boolean;
}

function isSiteSettingKey(key: string): key is SiteSettingKey {
  return (SITE_SETTING_KEYS as readonly string[]).includes(key);
}

function isKnownConfigKey(key: string): key is LegalConfigKey | SiteSettingKey {
  return isLegalConfigKey(key) || isSiteSettingKey(key);
}

// Defaults used when a fork's database has no row yet for a given setting
// (fresh install, or a key added after the fork's database was seeded).
const SITE_SETTING_DEFAULTS: Record<SiteSettingKey, string> = {
  location_privacy_default: 'public',
  event_cadence_weekday: '2', // 0 = Sunday … 6 = Saturday; 2 = Tuesday
  event_cadence_time: '18:30',
  home_show_stats: 'true', // toggles the home-page stats strip (members/dinners/etc.)
  brand_name: 'DinnerBears',
  brand_tagline: 'Good food. Great company. Bear memories.',
  theme_color_primary: '#C9933A',
  theme_color_accent: '#C9933A',
  theme_color_background: '#FDFAF5',
  // Empty = fall back to the frontend's compiled-in default asset. Set to an
  // /api/uploads/branding/... path once an admin uploads a replacement.
  brand_logo_url: '',
  brand_splash_url: '',
  brand_icon_url: '',
  // Home-page "Our Story" image. Unlike logo/splash/icon there is NO
  // compiled-in fallback — empty means the story image is simply hidden. A
  // migration seeds DinnerBears' existing map here; a fresh fork's bootstrap
  // clears it so a new instance shows just the story copy until it uploads one.
  brand_story_url: '',
  // All four empty on purpose -- see the key list above. A non-empty default
  // here would silently override the env var every install already has set.
  mail_domain: '',
  contact_support_email: '',
  contact_calendar_email: '',
  contact_event_email: '',
  // Terminology defaults keep DinnerBears' original wording; a fork overrides
  // these in /admin/settings (e.g. Sons → Location(s)/Meeting(s)/Points).
  term_location_singular: 'Location',
  term_location_plural: 'Locations',
  term_dinner_singular: 'Event',
  term_dinner_plural: 'Events',
  term_points: 'Points',
  // Feature toggles default on — an absent row resolves to enabled, so a fork
  // (or DinnerBears) keeps every feature until an admin turns one off.
  feature_ratings: 'true',
  // Phase 37: residences are not rateable by default — rating someone's
  // private home doesn't make sense. Still admin-overridable per instance.
  feature_ratings_residences: 'false',
  feature_leaderboard: 'true',
  feature_merch: 'true',
  feature_members: 'true',
  // Off by default — a fresh instance never enforces membership until an
  // admin explicitly opts in.
  feature_require_membership: 'false',
};

@Injectable()
export class AppConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tenantResolution: TenantResolutionService,
  ) {}

  async getPublicValue(key: string): Promise<string> {
    if (!isKnownConfigKey(key)) {
      throw new NotFoundException('Unknown config key');
    }
    const row = await this.prisma.app_config.findFirst({ where: { configKey: key } });
    if (row) return row.configValue;
    return isSiteSettingKey(key) ? SITE_SETTING_DEFAULTS[key] : '';
  }

  async getLegalConfig(): Promise<Pick<AppConfig, 'configKey' | 'configValue' | 'updatedAt'>[]> {
    // TypeORM's array-of-where was an OR over the keys; `in` is the same set.
    const rows = await this.prisma.app_config.findMany({
      where: { configKey: { in: [...LEGAL_CONFIG_KEYS] } },
    });
    return LEGAL_CONFIG_KEYS.map(
      (configKey) =>
        rows.find((r) => r.configKey === configKey) ?? {
          configKey,
          configValue: '',
          updatedAt: new Date(0),
        },
    );
  }

  async getSiteSettings(): Promise<Pick<AppConfig, 'configKey' | 'configValue' | 'updatedAt'>[]> {
    const rows = await this.prisma.app_config.findMany({
      where: { configKey: { in: [...SITE_SETTING_KEYS] } },
    });
    return SITE_SETTING_KEYS.map(
      (configKey) =>
        rows.find((r) => r.configKey === configKey) ?? {
          configKey,
          configValue: SITE_SETTING_DEFAULTS[configKey],
          updatedAt: new Date(0),
        },
    );
  }

  // Server-side read for other services (e.g. LocationsService picking the
  // default privacy for a newly created location) — no HTTP round-trip.
  async getSiteSetting(key: SiteSettingKey): Promise<string> {
    const row = await this.prisma.app_config.findFirst({ where: { configKey: key } });
    return row?.configValue ?? SITE_SETTING_DEFAULTS[key];
  }

  // ── Contact identity (REQ-TENANT-01.4) ──────────────────────
  //
  // Each of these answers "what address does THIS community put on the mail and
  // calendar entries it sends". They resolve most specific first:
  //
  //   1. the community's own address, if it set one
  //   2. an address derived from the community's own mail domain, if it set one
  //   3. the deployment-wide env var, which is what every existing install has
  //   4. an address derived from the deployment's mail domain
  //
  // Step 2 sits ABOVE step 3 deliberately. A community that has gone to the
  // trouble of naming its own mail domain has said something more specific than
  // the deployment default, so `hello@its-own-domain` beats the deployment's
  // SUPPORT_EMAIL; a community that has set nothing still gets exactly what it
  // got before these keys existed, which is what keeps this invisible to an
  // install that has not opted in. Steps 3 and 4 are instance-contact.ts,
  // unchanged and still the only place the env derivation lives.
  //
  // `tenantId` is for callers with no ambient tenant -- a cron sweep running
  // under runUnscoped, which must name the tenant it is composing for rather
  // than read whichever row the engine reaches first. Request-path callers omit
  // it and inherit the resolved tenant.

  /**
   * The community's mail domain.
   *
   * Deliberately NOT derived from the tenant's own host. A tenant is a web
   * host, and tenants below the apex are subdomains -- `dayton.example.com`
   * normally publishes no MX record at all, so deriving `hello@dayton.example.com`
   * from it would produce an address that silently bounces. That is the same
   * failure the "www." strip in instance-contact.ts exists to prevent, one
   * level down. A community whose subdomain really does accept mail says so by
   * setting mail_domain; otherwise it inherits the deployment's.
   */
  async mailDomain(tenantId?: number): Promise<string> {
    return (await this.ownMailDomain(tenantId)) ?? baseDomain(this.config);
  }

  /** Reply-to surfaced to members, e.g. in calendar-feed descriptions. */
  async supportEmail(tenantId?: number): Promise<string> {
    const own = await this.tenantSetting('contact_support_email', tenantId);
    if (own) return own;
    const domain = await this.ownMailDomain(tenantId);
    return domain ? `hello@${domain}` : envSupportEmail(this.config);
  }

  /** ORGANIZER on generated calendar feeds. */
  async calendarOrganizerEmail(tenantId?: number): Promise<string> {
    const own = await this.tenantSetting('contact_calendar_email', tenantId);
    if (own) return own;
    const domain = await this.ownMailDomain(tenantId);
    return domain
      ? `${this.calendarLocalPart()}@${domain}`
      : envCalendarOrganizerEmail(this.config);
  }

  /** ORGANIZER on per-event .ics attachments. */
  async eventOrganizerEmail(tenantId?: number): Promise<string> {
    const own = await this.tenantSetting('contact_event_email', tenantId);
    if (own) return own;
    const domain = await this.ownMailDomain(tenantId);
    return domain ? `noreply@${domain}` : envEventOrganizerEmail(this.config);
  }

  /**
   * "calendar" or "calendar-stage". Keyed on APP_URL because it asks "is this
   * deployment stage", which is true of the process and not of any one
   * community -- the same reason CalendarService.appName() stays on APP_URL.
   * Mirrors instance-contact.ts; kept in step with it by their shared spec.
   */
  private calendarLocalPart(): string {
    const appUrl = this.config.get<string>('APP_URL', 'https://dinnerbears.com');
    return appUrl.includes('stage') ? 'calendar-stage' : 'calendar';
  }

  /**
   * Whether the ambient tenant is the root one.
   *
   * Read from the registry rather than compared against APP_URL: `tenants` is
   * global so this needs no waiver, and `is_root` is the database's own answer
   * -- the same column SystemAdminGuard checks, so the UI and the guard cannot
   * disagree about which community this is.
   */
  private async servingRootTenant(): Promise<boolean> {
    const tenantId = currentTenantId();
    if (!tenantId) return false;
    const tenant = await this.prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { isRoot: true },
    });
    return tenant?.isRoot ?? false;
  }

  /** The tenant's own mail domain, or null when it has not set one. */
  private async ownMailDomain(tenantId?: number): Promise<string | null> {
    const own = await this.tenantSetting('mail_domain', tenantId);
    // Same "www is a web host, never a mail domain" strip instance-contact.ts
    // applies -- an admin pasting their site URL in here is the likely input.
    return own ? own.replace(/^www\./i, '') : null;
  }

  /**
   * One setting for one tenant, trimmed, with blank treated as unset.
   *
   * Awaited *inside* the runWithTenant callback, not returned from it: Prisma
   * promises are lazy, so returning the promise would build the query in the
   * tenant context and run it outside.
   */
  private async tenantSetting(key: SiteSettingKey, tenantId?: number): Promise<string> {
    const read = async (): Promise<string> => (await this.getSiteSetting(key)).trim();
    return tenantId === undefined ? read() : runWithTenant(tenantId, read);
  }

  // Server-side feature-flag check used by FeatureGuard and any service that
  // needs to enforce a toggle (never trust the client having hidden the nav).
  // A missing/blank row resolves to the default ('true' = enabled).
  async isFeatureEnabled(key: FeatureKey): Promise<boolean> {
    return (await this.getSiteSetting(key)) !== 'false';
  }

  async getFeatureFlags(): Promise<FeatureFlags> {
    const [ratings, ratingsResidences, leaderboard, merch, members, requireMembership] = await Promise.all([
      this.isFeatureEnabled('feature_ratings'),
      this.isFeatureEnabled('feature_ratings_residences'),
      this.isFeatureEnabled('feature_leaderboard'),
      this.isFeatureEnabled('feature_merch'),
      this.isFeatureEnabled('feature_members'),
      this.isFeatureEnabled('feature_require_membership'),
    ]);
    return { ratings, ratingsResidences, leaderboard, merch, members, requireMembership };
  }

  // Bundled for the public GET /config/branding endpoint — one request for
  // the app shell to apply at bootstrap instead of five. Beyond the DB-backed
  // branding rows, this also surfaces the handful of per-instance values that
  // used to be compiled into the frontend bundle (VAPID public key, Facebook
  // app id, stage flag, canonical URL, cookie base domain) — all read from
  // this instance's own .env — so a single generic image can serve any
  // instance with no per-instance build.
  async getBrandingConfig(): Promise<{
    name: string;
    tagline: string;
    colorPrimary: string;
    colorAccent: string;
    colorBackground: string;
    logoUrl: string;
    splashUrl: string;
    iconUrl: string;
    storyUrl: string;
    vapidPublicKey: string | null;
    facebookAppId: string | null;
    isStage: boolean;
    /**
     * Whether the community being served is the root one.
     *
     * Needed by the frontend, which otherwise has no way to tell: every tenant
     * looks identical from the browser. The role picker uses it to stop
     * offering `system_admin` on a community where the API would refuse it --
     * an option that always fails is worse than no option.
     */
    isRoot: boolean;
    appUrl: string;
    baseDomain: string;
    terms: {
      locationSingular: string;
      locationPlural: string;
      dinnerSingular: string;
      dinnerPlural: string;
      points: string;
    };
    features: FeatureFlags;
  }> {
    const [
      name,
      tagline,
      colorPrimary,
      colorAccent,
      colorBackground,
      logoUrl,
      splashUrl,
      iconUrl,
      storyUrl,
      locationSingular,
      locationPlural,
      dinnerSingular,
      dinnerPlural,
      points,
      features,
    ] = await Promise.all([
      this.getSiteSetting('brand_name'),
      this.getSiteSetting('brand_tagline'),
      this.getSiteSetting('theme_color_primary'),
      this.getSiteSetting('theme_color_accent'),
      this.getSiteSetting('theme_color_background'),
      this.getSiteSetting('brand_logo_url'),
      this.getSiteSetting('brand_splash_url'),
      this.getSiteSetting('brand_icon_url'),
      this.getSiteSetting('brand_story_url'),
      this.getSiteSetting('term_location_singular'),
      this.getSiteSetting('term_location_plural'),
      this.getSiteSetting('term_dinner_singular'),
      this.getSiteSetting('term_dinner_plural'),
      this.getSiteSetting('term_points'),
      this.getFeatureFlags(),
    ]);
    return {
      name,
      tagline,
      colorPrimary,
      colorAccent,
      colorBackground,
      logoUrl,
      splashUrl,
      iconUrl,
      storyUrl,
      terms: {
        locationSingular,
        locationPlural,
        dinnerSingular,
        dinnerPlural,
        points,
      },
      features,
      vapidPublicKey: this.config.get<string>('VAPID_PUBLIC_KEY') ?? null,
      facebookAppId: this.config.get<string>('FACEBOOK_APP_ID') ?? null,
      isStage: this.config.get<string>('IS_STAGE') === 'true',
      isRoot: await this.servingRootTenant(),
      // The requesting tenant's own canonical URL, not the deployment's. Every
      // other field in this payload is per-tenant (app_config is scoped now), so
      // a deployment-global value here would be the one thing in the branding
      // response that describes somebody else's community.
      appUrl: await this.tenantResolution.baseUrlFor(),
      // The requesting community's mail domain, resolved the same way the
      // contact addresses in its calendar feeds are, so the value the frontend
      // shows and the value those addresses are built from cannot disagree.
      // NOT the cookie scope any more -- v2-6 made the session cookie
      // host-only; see auth-cookie.util.ts.
      baseDomain: await this.mailDomain(),
    };
  }

  async updateConfigValue(key: string, value: string, userId: number): Promise<AppConfig> {
    if (!isKnownConfigKey(key)) {
      throw new NotFoundException('Unknown config key');
    }
    // find-or-create then assign becomes one upsert on the unique key.
    //
    // The one place in this file that names the tenant by hand, and the reason
    // is Prisma's, not ours: `upsert.where` must identify a row uniquely, the
    // unique key is now the compound (tenant_id, config_key), and Prisma spells
    // a compound key as a single nested object it cannot merge a separate
    // `tenantId` into. `requireTenantId` is the same escape hatch raw SQL uses,
    // and it throws rather than guessing when there is no tenant in context.
    return this.prisma.app_config.upsert({
      where: { tenantId_configKey: { tenantId: requireTenantId('app config update'), configKey: key } },
      update: { configValue: value, updatedBy: userId },
      create: { configKey: key, configValue: value, updatedBy: userId },
    });
  }

  // Saves many keys in one call — used by the /admin/settings form, which
  // otherwise fired one PATCH per field (19 as of Phase 33's feature toggles)
  // and could trip the global write-rate-limit fallback in
  // ThrottlerAuditGuard (30 writes/60s/IP) on a double-click or retry.
  async updateConfigValues(
    entries: Array<{ key: string; value: string }>,
    userId: number,
  ): Promise<void> {
    for (const { key } of entries) {
      if (!isKnownConfigKey(key)) {
        throw new NotFoundException(`Unknown config key: ${key}`);
      }
    }
    // Wrapped in a transaction: the admin settings form submits every field
    // at once, and a failure partway through previously left some keys saved
    // and the rest not.
    // Read once outside the map: it is the same tenant for every entry, and
    // calling it per row would only repeat the same throw-or-return.
    const tenantId = requireTenantId('app config bulk update');
    await this.prisma.$transaction(
      entries.map(({ key, value }) =>
        this.prisma.app_config.upsert({
          where: { tenantId_configKey: { tenantId, configKey: key } },
          update: { configValue: value, updatedBy: userId },
          create: { configKey: key, configValue: value, updatedBy: userId },
        }),
      ),
    );
  }
}
