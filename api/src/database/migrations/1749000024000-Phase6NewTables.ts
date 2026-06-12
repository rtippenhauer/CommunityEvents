import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase6NewTables1749000024000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE feedback_notes (
        id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        feedback_id   INT UNSIGNED NOT NULL,
        author_id     INT UNSIGNED NOT NULL,
        content       TEXT NOT NULL,
        is_admin_only TINYINT(1)   NOT NULL DEFAULT 0,
        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_fnote_feedback FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE,
        CONSTRAINT fk_fnote_author   FOREIGN KEY (author_id)   REFERENCES users(id)    ON DELETE CASCADE,
        INDEX idx_fnote_feedback (feedback_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE feedback_upvotes (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        feedback_id INT UNSIGNED NOT NULL,
        member_id   INT UNSIGNED NOT NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_fup_feedback FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE,
        CONSTRAINT fk_fup_member   FOREIGN KEY (member_id)   REFERENCES users(id)    ON DELETE CASCADE,
        UNIQUE KEY uq_feedback_member (feedback_id, member_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE releases (
        id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        version      VARCHAR(20)  NOT NULL,
        title        VARCHAR(200) NOT NULL,
        body         TEXT         NOT NULL,
        published_at DATETIME     NULL,
        created_by   INT UNSIGNED NOT NULL,
        created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_release_author FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
        UNIQUE KEY uq_release_version (version),
        INDEX idx_release_published (published_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE release_feedback (
        release_id  INT UNSIGNED NOT NULL,
        feedback_id INT UNSIGNED NOT NULL,
        PRIMARY KEY (release_id, feedback_id),
        CONSTRAINT fk_rf_release  FOREIGN KEY (release_id)  REFERENCES releases(id) ON DELETE CASCADE,
        CONSTRAINT fk_rf_feedback FOREIGN KEY (feedback_id) REFERENCES feedback(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE release_feedback`);
    await queryRunner.query(`DROP TABLE releases`);
    await queryRunner.query(`DROP TABLE feedback_upvotes`);
    await queryRunner.query(`DROP TABLE feedback_notes`);
  }
}
