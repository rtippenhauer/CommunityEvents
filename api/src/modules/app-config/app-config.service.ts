import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AppConfigEntity } from '../../database/entities/app-config.entity';
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
] as const;
export type SiteSettingKey = (typeof SITE_SETTING_KEYS)[number];

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
};

@Injectable()
export class AppConfigService {
  constructor(
    @InjectRepository(AppConfigEntity)
    private readonly configRepo: Repository<AppConfigEntity>,
    private readonly config: ConfigService,
  ) {}

  async getPublicValue(key: string): Promise<string> {
    if (!isKnownConfigKey(key)) {
      throw new NotFoundException('Unknown config key');
    }
    const row = await this.configRepo.findOne({ where: { configKey: key } });
    if (row) return row.configValue;
    return isSiteSettingKey(key) ? SITE_SETTING_DEFAULTS[key] : '';
  }

  async getLegalConfig(): Promise<Pick<AppConfigEntity, 'configKey' | 'configValue' | 'updatedAt'>[]> {
    const rows = await this.configRepo.find({
      where: LEGAL_CONFIG_KEYS.map((configKey) => ({ configKey })),
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

  async getSiteSettings(): Promise<Pick<AppConfigEntity, 'configKey' | 'configValue' | 'updatedAt'>[]> {
    const rows = await this.configRepo.find({
      where: SITE_SETTING_KEYS.map((configKey) => ({ configKey })),
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
    const row = await this.configRepo.findOne({ where: { configKey: key } });
    return row?.configValue ?? SITE_SETTING_DEFAULTS[key];
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

  async updateConfigValue(key: string, value: string, userId: number): Promise<AppConfigEntity> {
    if (!isKnownConfigKey(key)) {
      throw new NotFoundException('Unknown config key');
    }
    let row = await this.configRepo.findOne({ where: { configKey: key } });
    if (!row) {
      row = this.configRepo.create({ configKey: key, configValue: '' });
    }
    row.configValue = value;
    row.updatedBy = userId;
    return this.configRepo.save(row);
  }
}
