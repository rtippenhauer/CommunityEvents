import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 33 (per-instance feature toggles): major nav features become
// admin-configurable on/off switches stored as app_config boolean rows
// ('true'/'false'). Defaults are ALL 'true' — every feature stays on, so both
// DinnerBears and a fresh fork are unchanged; a fork simply flips off what it
// doesn't want in /admin/settings. Because the code default is 'true', an
// absent row already resolves to enabled — this seed just makes the rows exist
// (visible + documented in the DB); no fork-bootstrap deletion is needed since
// there's no DinnerBears-specific value to pin.
//
// `feature_ratings_residences` is a sub-rule of `feature_ratings`: ratings can
// be on globally but suppressed specifically for Residence locations (rating
// someone's private home makes little sense). Default 'true' preserves today's
// behavior (residences are rateable) until an admin turns it off.
export class SeedFeatureToggles1785000000007 implements MigrationInterface {
  private readonly keys = [
    'feature_ratings',
    'feature_ratings_residences',
    'feature_leaderboard',
    'feature_merch',
    'feature_members',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = (await queryRunner.query(
      `SELECT config_key FROM app_config WHERE config_key IN (?, ?, ?, ?, ?)`,
      this.keys,
    )) as Array<{ config_key: string }>;
    const existingKeys = new Set(existing.map((r) => r.config_key));

    const seedRows: Array<[string, string, string]> = [
      ['feature_ratings', 'true', 'Enable the ratings system (Rate Visits nav, rating queue, location ratings)'],
      ['feature_ratings_residences', 'true', 'Allow ratings on Residence locations (sub-rule of feature_ratings)'],
      ['feature_leaderboard', 'true', 'Enable the points Leaderboard nav item and page'],
      ['feature_merch', 'true', 'Enable the Merch store nav item and page'],
      ['feature_members', 'true', 'Enable the Members directory nav item and page'],
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
