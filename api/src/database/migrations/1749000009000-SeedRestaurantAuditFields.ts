import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedRestaurantAuditFields1749000009000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE restaurants
      SET
        created_by  = 1,
        updated_by  = 1,
        enriched_at = COALESCE(enriched_at, NOW())
      WHERE created_by IS NULL
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Not reversible — audit fields left as-is on rollback
  }
}
