import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAnnouncements1749000028000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE announcements (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        title VARCHAR(200) NOT NULL,
        body LONGTEXT NOT NULL,
        city_id INT UNSIGNED NULL,
        status ENUM('draft','published') NOT NULL DEFAULT 'draft',
        published_at DATETIME NULL,
        created_by INT UNSIGNED NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        CONSTRAINT fk_ann_city FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE SET NULL,
        CONSTRAINT fk_ann_author FOREIGN KEY (created_by) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await queryRunner.query(`
      CREATE TABLE announcement_comments (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        announcement_id INT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        body TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME NULL,
        PRIMARY KEY (id),
        CONSTRAINT fk_ann_comment_ann FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
        CONSTRAINT fk_ann_comment_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await queryRunner.query(`
      CREATE TABLE content_flags (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        content_type ENUM('announcement','announcement_comment') NOT NULL,
        content_id INT UNSIGNED NOT NULL,
        reported_by INT UNSIGNED NOT NULL,
        reason VARCHAR(500) NULL,
        status ENUM('pending','reviewed','dismissed') NOT NULL DEFAULT 'pending',
        reviewed_by INT UNSIGNED NULL,
        reviewed_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_flag (content_type, content_id, reported_by),
        CONSTRAINT fk_flag_reporter FOREIGN KEY (reported_by) REFERENCES users(id),
        CONSTRAINT fk_flag_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE content_flags`);
    await queryRunner.query(`DROP TABLE announcement_comments`);
    await queryRunner.query(`DROP TABLE announcements`);
  }
}
