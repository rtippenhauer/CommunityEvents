import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFeedbackReleaseNote1749000026000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.query(`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback' AND COLUMN_NAME = 'release_note'
    `);
    if (!existing.length) {
      await queryRunner.query(
        `ALTER TABLE feedback ADD COLUMN release_note VARCHAR(500) NULL AFTER admin_note`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE feedback DROP COLUMN IF EXISTS release_note`);
  }
}
