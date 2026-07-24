import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfigEntity } from '../../database/entities/app-config.entity';

// Only these keys are servable/editable through the config endpoints — keeps
// this generic key/value table from becoming an accidental back door into
// unrelated app_config rows (invite expiry windows, inactivity thresholds,
// etc.) that this admin editor was never meant to manage.
export const LEGAL_CONFIG_KEYS = [
  'legal_terms_html',
  'legal_privacy_html',
  'about_story_html',
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
  'brand_name',
  'brand_tagline',
  'theme_color_primary',
  'theme_color_accent',
  'theme_color_background',
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
  brand_name: 'DinnerBears',
  brand_tagline: 'Good food. Great company. Bear memories.',
  theme_color_primary: '#C9933A',
  theme_color_accent: '#C9933A',
  theme_color_background: '#FDFAF5',
};

@Injectable()
export class AppConfigService {
  constructor(
    @InjectRepository(AppConfigEntity)
    private readonly configRepo: Repository<AppConfigEntity>,
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
  // the app shell to apply at bootstrap instead of five.
  async getBrandingConfig(): Promise<{
    name: string;
    tagline: string;
    colorPrimary: string;
    colorAccent: string;
    colorBackground: string;
  }> {
    const [name, tagline, colorPrimary, colorAccent, colorBackground] = await Promise.all([
      this.getSiteSetting('brand_name'),
      this.getSiteSetting('brand_tagline'),
      this.getSiteSetting('theme_color_primary'),
      this.getSiteSetting('theme_color_accent'),
      this.getSiteSetting('theme_color_background'),
    ]);
    return { name, tagline, colorPrimary, colorAccent, colorBackground };
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
