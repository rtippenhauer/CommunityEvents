import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOAuthAndSessions1749000003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE oauth_accounts (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        provider ENUM('google','facebook') NOT NULL,
        provider_id VARCHAR(255) NOT NULL,
        email VARCHAR(255) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_provider_account (provider, provider_id),
        INDEX idx_user (user_id),
        CONSTRAINT fk_oauth_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE login_sessions (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        jwt_jti VARCHAR(100) NOT NULL,
        user_agent VARCHAR(500) NULL,
        ip_address VARCHAR(45) NULL,
        country VARCHAR(100) NULL,
        city VARCHAR(100) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_jti (jwt_jti),
        INDEX idx_user (user_id),
        CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS login_sessions`);
    await queryRunner.query(`DROP TABLE IF EXISTS oauth_accounts`);
  }
}
