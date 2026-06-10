import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFeedback1749000017000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE feedback (
        id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id      INT UNSIGNED NOT NULL,
        category     ENUM('bug','feature_request','comment') NOT NULL,
        body         TEXT NOT NULL,
        status       ENUM('new','under_review','in_progress','released','wont_do','duplicate') NOT NULL DEFAULT 'new',
        admin_note   TEXT NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_feedback_status (status),
        INDEX idx_feedback_category (category),
        INDEX idx_feedback_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE feedback`);
  }
}
