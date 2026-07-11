import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEmailSystem1749000014000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE email_queue (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        to_email        VARCHAR(255) NOT NULL,
        to_name         VARCHAR(200) NULL,
        subject         VARCHAR(500) NOT NULL,
        template_id     VARCHAR(100) NULL,
        template_params JSON NULL,
        html_body       LONGTEXT NULL,
        text_body       TEXT NULL,
        priority        TINYINT NOT NULL DEFAULT 5,
        status          ENUM('pending','sent','failed','cancelled','blocked') NOT NULL DEFAULT 'pending',
        provider        ENUM('brevo','gmail') NULL,
        attempts        INT NOT NULL DEFAULT 0,
        last_attempt_at DATETIME NULL,
        error_message   TEXT NULL,
        brevo_status    VARCHAR(100) NULL,
        send_after      DATETIME NULL,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at         DATETIME NULL,
        INDEX idx_status_priority (status, priority),
        INDEX idx_send_after (send_after)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // CreateUsers1749000002000 already creates this table (a historical
    // leftover in that migration) — guard against the duplicate here rather
    // than touching an already-applied earlier migration.
    const existingTables = await queryRunner.query(`
      SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_suppressions'
    `);
    if ((existingTables as unknown[]).length === 0) {
      await queryRunner.query(`
        CREATE TABLE email_suppressions (
          id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          email_hash  VARCHAR(255) NOT NULL UNIQUE,
          reason      ENUM('unsubscribed','bounced','complained') NOT NULL,
          created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }

    const today = new Date().toISOString().split('T')[0];
    await queryRunner.query(`
      CREATE TABLE email_provider_config (
        id                     INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        brevo_enabled          TINYINT(1) NOT NULL DEFAULT 1,
        gmail_overflow_enabled TINYINT(1) NOT NULL DEFAULT 0,
        brevo_daily_limit      INT NOT NULL DEFAULT 300,
        gmail_daily_limit      INT NOT NULL DEFAULT 500,
        brevo_sent_today       INT NOT NULL DEFAULT 0,
        gmail_sent_today       INT NOT NULL DEFAULT 0,
        last_reset_date        DATE NOT NULL,
        updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(
      `INSERT INTO email_provider_config (brevo_enabled, gmail_overflow_enabled, last_reset_date) VALUES (1, 0, ?)`,
      [today],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS email_provider_config`);
    await queryRunner.query(`DROP TABLE IF EXISTS email_suppressions`);
    await queryRunner.query(`DROP TABLE IF EXISTS email_queue`);
  }
}
