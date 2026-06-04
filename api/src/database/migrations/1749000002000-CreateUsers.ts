import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUsers1749000002000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        full_name VARCHAR(200) NOT NULL,
        email VARCHAR(255) NOT NULL,
        email_status ENUM('pending','active','unsubscribed','bounced','complained')
          NOT NULL DEFAULT 'pending',
        email_verified_at DATETIME NULL,
        password_hash VARCHAR(255) NULL,
        city_id INT UNSIGNED NOT NULL,
        role ENUM('member','moderator','admin') NOT NULL DEFAULT 'member',
        profile_photo_path VARCHAR(500) NULL,
        status ENUM('active','suspended','deleted') NOT NULL DEFAULT 'active',
        invited_by INT UNSIGNED NULL,
        invite_id INT UNSIGNED NULL,
        invite_source ENUM('direct','facebook_group','google_oauth') NULL,
        invite_source_name VARCHAR(255) NULL,
        last_login_at DATETIME NULL,
        login_count INT UNSIGNED NOT NULL DEFAULT 0,
        deleted_at DATETIME NULL,
        hard_delete_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_email (email),
        INDEX idx_email_status (email_status),
        INDEX idx_last_login (last_login_at),
        INDEX idx_invited_by (invited_by),
        INDEX idx_status (status),
        CONSTRAINT fk_users_city FOREIGN KEY (city_id) REFERENCES cities(id),
        CONSTRAINT fk_users_invited_by FOREIGN KEY (invited_by) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE email_suppressions (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        email_hash VARCHAR(255) NOT NULL,
        reason ENUM('unsubscribed','bounced','complained') NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_email_hash (email_hash)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS email_suppressions`);
    await queryRunner.query(`DROP TABLE IF EXISTS users`);
  }
}
