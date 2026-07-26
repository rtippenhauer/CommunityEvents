import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 32 (configurable terminology): the venue / gathering / points nouns
// become admin-configurable app_config rows. The *code* defaults are
// deliberately generic (Restaurant, Event, Points) so a fresh white-label fork
// reads neutrally, but this migration pins DinnerBears' own historical wording
// (Dinner(s), Bear Points) so the existing production instance is unchanged.
//
// A fresh fork's bootstrap (see bootstrap.ts) DELETES these rows so it falls
// back to the generic code defaults — note it must delete, not blank, because
// getSiteSetting only falls back on a missing row, not an empty value.
export class SeedTerminologyConfig1785000000004 implements MigrationInterface {
  private readonly keys = [
    'term_location_singular',
    'term_location_plural',
    'term_dinner_singular',
    'term_dinner_plural',
    'term_points',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = (await queryRunner.query(
      `SELECT config_key FROM app_config WHERE config_key IN (?, ?, ?, ?, ?)`,
      this.keys,
    )) as Array<{ config_key: string }>;
    const existingKeys = new Set(existing.map((r) => r.config_key));

    const seedRows: Array<[string, string, string]> = [
      ['term_location_singular', 'Restaurant', 'Singular term for a venue (e.g. Restaurant, Location)'],
      ['term_location_plural', 'Restaurants', 'Plural term for venues'],
      ['term_dinner_singular', 'Dinner', 'Singular term for a gathering/event (e.g. Dinner, Meeting)'],
      ['term_dinner_plural', 'Dinners', 'Plural term for gatherings/events'],
      ['term_points', 'Bear Points', 'Label for member points (e.g. Bear Points, Points)'],
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
