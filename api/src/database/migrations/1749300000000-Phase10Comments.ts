import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase10Comments1749300000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE event_comments (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        event_id INT UNSIGNED NOT NULL,
        member_id INT UNSIGNED NOT NULL,
        body TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        CONSTRAINT fk_ec_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        CONSTRAINT fk_ec_member FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_ec_event (event_id),
        INDEX idx_ec_member (member_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE event_comment_replies (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        comment_id INT UNSIGNED NOT NULL,
        member_id INT UNSIGNED NOT NULL,
        body TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        CONSTRAINT fk_ecr_comment FOREIGN KEY (comment_id) REFERENCES event_comments(id) ON DELETE CASCADE,
        CONSTRAINT fk_ecr_member FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_ecr_comment (comment_id),
        INDEX idx_ecr_member (member_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      ALTER TABLE event_rsvps ADD COLUMN attended TINYINT(1) NULL DEFAULT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE event_rsvps DROP COLUMN attended`);
    await queryRunner.query(`DROP TABLE event_comment_replies`);
    await queryRunner.query(`DROP TABLE event_comments`);
  }
}
