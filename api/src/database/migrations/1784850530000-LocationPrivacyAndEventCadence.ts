import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 29 (white-label template): per-location privacy (address hidden
// until a member RSVPs "Going", or is admin/mod) and a per-fork default
// event day/time to replace the hardcoded next-Tuesday-6:30pm assumption.
export class LocationPrivacyAndEventCadence1784850530000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const columns = await queryRunner.query(`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations' AND COLUMN_NAME = 'is_private'
    `);
    if ((columns as unknown[]).length === 0) {
      await queryRunner.query(`
        ALTER TABLE locations
          ADD COLUMN is_private TINYINT(1) NOT NULL DEFAULT 0 AFTER is_active
      `);
    }

    const existing = await queryRunner.query(`
      SELECT config_key FROM app_config
      WHERE config_key IN ('location_privacy_default', 'event_cadence_weekday', 'event_cadence_time')
    `);
    const existingKeys = new Set((existing as Array<{ config_key: string }>).map((r) => r.config_key));

    const seedRows: Array<[string, string, string]> = [
      ['location_privacy_default', 'public', 'Default privacy for newly created locations (public|private) — existing locations are unaffected'],
      ['event_cadence_weekday', '2', 'Day of week new events default to (0=Sunday…6=Saturday); 2=Tuesday'],
      ['event_cadence_time', '18:30', 'Time of day new events default to (24h HH:mm)'],
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
    await queryRunner.query(`
      DELETE FROM app_config
      WHERE config_key IN ('location_privacy_default', 'event_cadence_weekday', 'event_cadence_time')
    `);

    const columns = await queryRunner.query(`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'locations' AND COLUMN_NAME = 'is_private'
    `);
    if ((columns as unknown[]).length > 0) {
      await queryRunner.query(`ALTER TABLE locations DROP COLUMN is_private`);
    }
  }
}
