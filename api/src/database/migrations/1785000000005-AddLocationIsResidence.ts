import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 32 follow-up: mark a location as a residence (private home / non-business
// venue). Enrichment then skips the Google Places business lookup and only tries
// a Street View photo, leaving the address untouched.
export class AddLocationIsResidence1785000000005 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.query(
      `SELECT COUNT(*) AS n FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'locations' AND column_name = 'is_residence'`,
    );
    if (Number(table[0]?.n ?? 0) > 0) return; // already added
    await queryRunner.query(
      `ALTER TABLE locations ADD COLUMN is_residence TINYINT(1) NOT NULL DEFAULT 0 AFTER is_private`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE locations DROP COLUMN is_residence`);
  }
}
