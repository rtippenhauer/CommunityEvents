import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFeedbackResolvedAt1749100000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE feedback
        ADD COLUMN resolved_at DATETIME NULL DEFAULT NULL
          AFTER seen_at
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`ALTER TABLE feedback DROP COLUMN resolved_at`);
  }
}
