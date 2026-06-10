import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSeenAtToFeedback1749000018000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE feedback
        ADD COLUMN seen_at DATETIME NULL AFTER admin_note
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE feedback DROP COLUMN seen_at`);
  }
}
