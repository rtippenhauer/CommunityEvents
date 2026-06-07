import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRestaurantAuditFields1749000008000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE restaurants
        ADD COLUMN IF NOT EXISTS enriched_at  DATETIME NULL         AFTER updated_at,
        ADD COLUMN IF NOT EXISTS created_by   INT UNSIGNED NULL     AFTER enriched_at,
        ADD COLUMN IF NOT EXISTS updated_by   INT UNSIGNED NULL     AFTER created_by
    `);

    // Add FKs only if they don't already exist
    const fks = await queryRunner.query(`
      SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'restaurants'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
        AND CONSTRAINT_NAME IN ('fk_restaurant_created_by', 'fk_restaurant_updated_by')
    `);
    const existing = new Set((fks as Array<{ CONSTRAINT_NAME: string }>).map(r => r.CONSTRAINT_NAME));

    if (!existing.has('fk_restaurant_created_by')) {
      await queryRunner.query(`
        ALTER TABLE restaurants
          ADD CONSTRAINT fk_restaurant_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
      `);
    }
    if (!existing.has('fk_restaurant_updated_by')) {
      await queryRunner.query(`
        ALTER TABLE restaurants
          ADD CONSTRAINT fk_restaurant_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE restaurants
        DROP FOREIGN KEY fk_restaurant_created_by,
        DROP FOREIGN KEY fk_restaurant_updated_by
    `);
    await queryRunner.query(`
      ALTER TABLE restaurants
        DROP COLUMN enriched_at,
        DROP COLUMN created_by,
        DROP COLUMN updated_by
    `);
  }
}
