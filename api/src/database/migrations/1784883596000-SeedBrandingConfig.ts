import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 29 (white-label template): app name, tagline, and the three core
// theme colors move from hardcoded frontend literals to app_config rows,
// editable from /admin/settings without a rebuild — same mechanism as
// legal copy (Phase 30) and the location-privacy/event-cadence settings.
export class SeedBrandingConfig1784883596000 implements MigrationInterface {
  private readonly keys = [
    'brand_name',
    'brand_tagline',
    'theme_color_primary',
    'theme_color_accent',
    'theme_color_background',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.query(
      `SELECT config_key FROM app_config WHERE config_key IN (?, ?, ?, ?, ?)`,
      this.keys,
    );
    const existingKeys = new Set((existing as Array<{ config_key: string }>).map((r) => r.config_key));

    const seedRows: Array<[string, string, string]> = [
      ['brand_name', 'DinnerBears', 'App name shown in nav, footer, and page titles'],
      ['brand_tagline', 'Good food. Great company. Bear memories.', 'Short tagline shown on the login page and footer'],
      ['theme_color_primary', '#C9933A', 'Primary brand color (buttons, links, accents)'],
      ['theme_color_accent', '#C9933A', 'Secondary accent color'],
      ['theme_color_background', '#FDFAF5', 'Page background color'],
    ];
    for (const [key, value, description] of seedRows) {
      if (existingKeys.has(key)) continue;
      await queryRunner.query(
        `INSERT INTO app_config (config_key, config_value, description) VALUES (?, ?, ?)`,
        [key, value, description],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM app_config WHERE config_key IN (?, ?, ?, ?, ?)`,
      this.keys,
    );
  }
}
