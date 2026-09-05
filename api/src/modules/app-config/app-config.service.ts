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
import { LEGAL_DEFAULT_ROWS, fillLegalPlaceholders } from '../../common/legal/legal-defaults';
import { currentTenantId, requireTenantId, runWithTenant } from '../../common/tenant/tenant-store';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import { TenantOAuthService } from '../../common/tenant/tenant-oauth.service';
import { FOUNDING_ACHIEVEMENT_KEY } from '../../common/achievements/achievement-defaults';
import {
  DEFAULT_TERM_LOCATION_SINGULAR,
  DEFAULT_TERM_LOCATION_PLURAL,
  DEFAULT_TERM_DINNER_SINGULAR,
  DEFAULT_TERM_DINNER_PLURAL,
  DEFAULT_TERM_POINTS,
} from '../../common/config/term-defaults';

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
  'brand_error_url',
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
  // When this community last confirmed its Terms and Privacy Policy (ISO
  // timestamp; empty = never). A community is seeded with platform templates so
  // its legal pages are never blank, and this is what says a human has since
  // read them. Public like every other site setting — it says a review
  // happened, not what was reviewed.
  'legal_reviewed_at',
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
/**
 * The platform's own logo, used wherever a community has uploaded none.
 *
 * Deliberately a raster and deliberately NOT the generated SVG marks the app
 * uses in-browser: the two consumers are email and push notifications, and
 * neither can take an SVG -- Gmail and Outlook strip it, and browsers do not
 * reliably render one as a notification icon. Generated by
 * `scripts/generate-platform-logo.js`; replacing the file it writes is all that
 * is needed to swap in real artwork.
 */
const PLATFORM_LOGO_PATH = '/brand/communityevents-logo.png';

export const SITE_SETTING_DEFAULTS: Record<SiteSettingKey, string> = {
  location_privacy_default: 'public',
  event_cadence_weekday: '2', // 0 = Sunday … 6 = Saturday; 2 = Tuesday
  event_cadence_time: '18:30',
  home_show_stats: 'true', // toggles the home-page stats strip (members/dinners/etc.)
  brand_name: 'CommunityEvents',
  brand_tagline: 'Good food. Great company.',
  theme_color_primary: '#C9933A',
  theme_color_accent: '#C9933A',
  theme_color_background: '#FDFAF5',
  // Empty = fall back to the frontend's compiled-in default asset. Set to an
  // /api/uploads/branding/... path once an admin uploads a replacement.
  brand_logo_url: '',
  brand_splash_url: '',
  // Backdrop behind the card on every error page (v2-10). Empty is a real
  // choice, not a missing value: with none uploaded the page draws a
  // gradient from this community's own brand colours, which is why there is
  // no compiled-in default image here the way there was before.
  brand_error_url: '',
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
  // Terminology defaults are the generic platform wording; a community overrides
  // these in /admin/settings (e.g. Sons → Location(s)/Meeting(s)/Points).
  term_location_singular: DEFAULT_TERM_LOCATION_SINGULAR,
  term_location_plural: DEFAULT_TERM_LOCATION_PLURAL,
  term_dinner_singular: DEFAULT_TERM_DINNER_SINGULAR,
  term_dinner_plural: DEFAULT_TERM_DINNER_PLURAL,
  term_points: DEFAULT_TERM_POINTS,
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
  // Empty until a human confirms the seeded legal copy. Never defaulted to a
  // date: the whole value of the flag is that it cannot be true by accident.
  legal_reviewed_at: '',
};

@Injectable()
export class AppConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tenantResolution: TenantResolutionService,
    private readonly tenantOAuth: TenantOAuthService,
  ) {}

  async getPublicValue(key: string): Promise<string> {
    if (!isKnownConfigKey(key)) {
      throw new NotFoundException('Unknown config key');
    }
    const row = await this.prisma.app_config.findFirst({ where: { configKey: key } });
    const value = row?.configValue ?? (isSiteSettingKey(key) ? SITE_SETTING_DEFAULTS[key] : '');
    // Only the public read is filled in. `getLegalConfig` hands the admin
    // editor the raw copy, placeholders included, or saving would freeze
    // today's name into the document as literal text.
    return isLegalConfigKey(key) ? this.fillLegalCopy(value) : value;
  }

  /**
   * The community's name, its operator and its support address, substituted
   * into whatever legal copy it currently has. See `legal-defaults.ts` for why
   * this happens on read.
   */
  private async fillLegalCopy(html: string): Promise<string> {
    if (!html.includes('{{')) return html;
    const [brandName, supportEmail] = await Promise.all([
      this.brandName(),
      this.supportEmail(),
    ]);
    // The operator is a deployment fact, not a community one -- one company
    // runs every community on this deployment. Falling back to the community's
    // own name keeps an install that never set it readable rather than leaving
    // "{{legal_entity}}" on a public page.
    const legalEntity = this.config.get<string>('LEGAL_ENTITY_NAME')?.trim() || brandName;
    return fillLegalPlaceholders(html, { brandName, legalEntity, supportEmail });
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

  /**
   * What this community calls itself, for anything a member reads.
   *
   * The community's own `brand_name` if it has set one, otherwise the
   * deployment default. Deliberately falls back rather than throwing: an email
   * with a generic name is a cosmetic problem, an email that fails to send is
   * not.
   *
   * **Returns the default when there is no tenant in context**, rather than
   * reading whichever row comes back first. `app_config` is tenant-scoped, so
   * a read under `runUnscoped` would answer with an arbitrary community's name
   * -- the trap v2-6 documented for branding in cron sweeps. A sweep that wants
   * a specific community's name must re-enter `runWithTenant`, which is the
   * same rule `baseUrlFor()` follows.
   */
  async brandName(): Promise<string> {
    if (typeof currentTenantId() !== 'number') return SITE_SETTING_DEFAULTS.brand_name;
    return this.getSiteSetting('brand_name');
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
    const appUrl = this.config.get<string>('APP_URL', 'https://communityeventsproject.com');
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
  /**
   * The community's own name for its founding achievement.
   *
   * Falls back to the platform default when the row is missing -- which happens
   * only if an admin deleted it, since every community is seeded with one. The
   * `title` is preferred over `name` because that is the field the badge is
   * displayed under; both are the community's to edit.
   */
  /**
   * Absolute URL of the logo to use outside the browser -- email headers and
   * push notifications.
   *
   * The community's own uploaded logo when it has one, otherwise the platform
   * mark. It has to be absolute and on this community's own host, because the
   * recipient is reading it in a mail client or an OS notification with no page
   * to resolve a relative path against.
   *
   * Not the same resolution as the frontend's `logoSrc`, which falls back to a
   * mark generated from the community's name and palette. That is the better
   * answer in-app and an impossible one here: it produces an SVG data URI, and
   * neither consumer of this method can render one.
   */
  async absoluteLogoUrl(): Promise<string> {
    const [uploaded, appUrl] = await Promise.all([
      this.getSiteSetting('brand_logo_url'),
      this.tenantResolution.baseUrlFor(),
    ]);
    return `${appUrl}${uploaded || PLATFORM_LOGO_PATH}`;
  }

  private async foundingAchievementLabel(): Promise<string> {
    const row = await this.prisma.achievements.findFirst({
      where: { key: FOUNDING_ACHIEVEMENT_KEY },
      select: { name: true, title: true },
    });
    return row?.title?.trim() || row?.name?.trim() || 'Founding Member';
  }

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
    errorUrl: string;
    iconUrl: string;
    storyUrl: string;
    vapidPublicKey: string | null;
    facebookAppId: string | null;
    /**
     * Which sign-in methods this community offers (REQ-TENANT-01.9).
     *
     * Carried here rather than on a new endpoint because the login page already
     * fetches this payload before anything is rendered, and a second
     * unauthenticated round-trip to answer "which buttons?" would show the form
     * twice -- once wrong. `GET /auth/providers` cannot answer it: that route
     * is JwtAuthGuard-ed and reports the *signed-in* member's linked accounts,
     * which is a different question asked at a different time.
     *
     * Email/password is absent because it is not a variable: it is available on
     * every community, with no configuration.
     */
    authProviders: { google: boolean; facebook: boolean };
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
    /**
     * Whether a human has confirmed this community's Terms and Privacy Policy.
     *
     * A community is seeded with the platform's templates so its legal pages
     * are never blank; this is what says somebody has since read them. Carried
     * in the branding payload rather than fetched separately so the admin
     * banner costs no request -- and it is no more public than the
     * `legal_reviewed_at` setting it reads, which like every site setting is
     * already servable from /config/:key.
     */
    legalReviewed: boolean;
    /** This community's support address, not a deployment-wide one (v2-10). */
    supportEmail: string;
    /** What this community calls its founding badge (v2-10). */
    foundingLabel: string;
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
      errorUrl,
      iconUrl,
      storyUrl,
      locationSingular,
      locationPlural,
      dinnerSingular,
      dinnerPlural,
      points,
      features,
      legalReviewedAt,
    ] = await Promise.all([
      this.getSiteSetting('brand_name'),
      this.getSiteSetting('brand_tagline'),
      this.getSiteSetting('theme_color_primary'),
      this.getSiteSetting('theme_color_accent'),
      this.getSiteSetting('theme_color_background'),
      this.getSiteSetting('brand_logo_url'),
      this.getSiteSetting('brand_splash_url'),
      this.getSiteSetting('brand_error_url'),
      this.getSiteSetting('brand_icon_url'),
      this.getSiteSetting('brand_story_url'),
      this.getSiteSetting('term_location_singular'),
      this.getSiteSetting('term_location_plural'),
      this.getSiteSetting('term_dinner_singular'),
      this.getSiteSetting('term_dinner_plural'),
      this.getSiteSetting('term_points'),
      this.getFeatureFlags(),
      this.getSiteSetting('legal_reviewed_at'),
    ]);
    return {
      name,
      tagline,
      colorPrimary,
      colorAccent,
      colorBackground,
      logoUrl,
      splashUrl,
      errorUrl,
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
      // The community's own Meta app, not the deployment's -- there is no
      // deployment-wide app any more (v2-8). Null switches every Facebook
      // control off in the frontend, which is exactly what a community that
      // registered no app should show.
      facebookAppId: await this.tenantOAuth.facebookAppId(),
      authProviders: await this.tenantOAuth.offeredProviders(),
      isStage: this.config.get<string>('IS_STAGE') === 'true',
      isRoot: await this.servingRootTenant(),
      // The community's own support address (v2-10). Two member-facing pages
      // -- account deletion and the Facebook data-deletion callback -- told
      // people to email support@dinnerbears.com, a hardcoded address belonging
      // to one community and reachable by none of the others. Resolved through
      // the same most-specific-first chain as everywhere else: the community's
      // own contact_support_email, then a derivation from its mail domain, then
      // SUPPORT_EMAIL, then the deployment domain.
      supportEmail: await this.supportEmail(),
      // What this community calls its founding badge (v2-10). The frontend used
      // to derive it by comparing brand_name against the literal 'dinnerbears',
      // which was a guess standing in for data that did not exist -- the
      // catalogue was global, so there was no per-community badge to read. Now
      // that it is scoped, the community's own row IS the label, and a community
      // that renames the badge sees the new name in the surrounding UI (merch
      // gate, achievement headers) instead of a name derived from its brand.
      foundingLabel: await this.foundingAchievementLabel(),
      legalReviewed: legalReviewedAt.trim().length > 0,
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

  /**
   * Puts this community's Terms and Privacy Policy back to the platform
   * templates.
   *
   * Needed because seeding only ever runs at creation: a community whose copy
   * predates the templates -- or one that edited itself into a corner -- has no
   * other route back, since `bootstrap.ts` INSERT IGNOREs and will not touch a
   * row that exists.
   *
   * Clears `legal_reviewed_at` deliberately. Restoring is the opposite of
   * reviewing: it replaces the copy with something nobody has read, so the
   * banner comes back until somebody does.
   */
  async restoreLegalDefaults(userId: number): Promise<void> {
    for (const row of LEGAL_DEFAULT_ROWS) {
      await this.updateConfigValue(row.configKey, row.configValue, userId);
    }
    await this.updateConfigValue('legal_reviewed_at', '', userId);
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
