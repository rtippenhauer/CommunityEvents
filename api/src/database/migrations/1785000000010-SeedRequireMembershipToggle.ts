import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 35 (membership fee): unlike the Phase 33 toggles this defaults to
// 'false' — a brand-new concept nothing depends on, so no instance suddenly
// starts enforcing membership just from this migration running.
export class SeedRequireMembershipToggle1785000000010 implements MigrationInterface {
  private readonly key = 'feature_require_membership';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = (await queryRunner.query(
      `SELECT config_key FROM app_config WHERE config_key = ?`,
      [this.key],
    )) as Array<{ config_key: string }>;
    if (existing.length > 0) return;

    await queryRunner.query(
      `INSERT INTO app_config (config_key, config_value, description) VALUES (?, ?, ?)`,
      [this.key, 'false', 'Require an active membership to RSVP Going, after a member\'s free first meeting'],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM app_config WHERE config_key = ?`, [this.key]);
  }
}
