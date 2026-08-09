import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { app_config as AppConfig } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { baseDomain } from '../../common/config/instance-contact';

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
  ) {}

  async getPublicValue(key: string): Promise<string> {
    if (!isKnownConfigKey(key)) {
      throw new NotFoundException('Unknown config key');
    }
    const row = await this.prisma.app_config.findUnique({ where: { configKey: key } });
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
    const row = await this.prisma.app_config.findUnique({ where: { configKey: key } });
    return row?.configValue ?? SITE_SETTING_DEFAULTS[key];
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
      appUrl: this.config.get<string>('APP_URL') ?? '',
      // Use the shared derivation (BASE_DOMAIN, else APP_URL host sans "www.")
      // so the frontend gets the same value the cookie scope + contact emails
      // use — instances rarely set BASE_DOMAIN explicitly.
      baseDomain: baseDomain(this.config),
    };
  }

  async updateConfigValue(key: string, value: string, userId: number): Promise<AppConfig> {
    if (!isKnownConfigKey(key)) {
      throw new NotFoundException('Unknown config key');
    }
    // find-or-create then assign becomes one upsert on the unique key.
    return this.prisma.app_config.upsert({
      where: { configKey: key },
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
    await this.prisma.$transaction(
      entries.map(({ key, value }) =>
        this.prisma.app_config.upsert({
          where: { configKey: key },
          update: { configValue: value, updatedBy: userId },
          create: { configKey: key, configValue: value, updatedBy: userId },
        }),
      ),
    );
  }
}
