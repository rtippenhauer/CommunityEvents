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

@Injectable()
export class AppConfigService {
  constructor(
    @InjectRepository(AppConfigEntity)
    private readonly configRepo: Repository<AppConfigEntity>,
  ) {}

  async getPublicValue(key: string): Promise<string> {
    if (!isLegalConfigKey(key)) {
      throw new NotFoundException('Unknown config key');
    }
    const row = await this.configRepo.findOne({ where: { configKey: key } });
    return row?.configValue ?? '';
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

  async updateLegalConfig(key: string, value: string, userId: number): Promise<AppConfigEntity> {
    if (!isLegalConfigKey(key)) {
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
