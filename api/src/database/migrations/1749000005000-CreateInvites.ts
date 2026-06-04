import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvites1749000005000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE invites (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        token VARCHAR(100) NOT NULL,
        type ENUM('member','admin','campaign_facebook','guest_rsvp','shareable_rsvp') NOT NULL,
        created_by INT UNSIGNED NOT NULL,
        city_id INT UNSIGNED NULL,
        event_id INT UNSIGNED NULL,
        facebook_group_id INT UNSIGNED NULL,
        bound_to_email VARCHAR(255) NULL,
        bound_to_name VARCHAR(200) NULL,
        redeemed_by INT UNSIGNED NULL,
        redeemed_at DATETIME NULL,
        guest_rsvp_id INT UNSIGNED NULL,
        expires_at DATETIME NOT NULL,
        is_revoked TINYINT(1) NOT NULL DEFAULT 0,
        max_uses INT NULL DEFAULT 1,
        use_count INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_token (token),
        INDEX idx_token (token),
        INDEX idx_created_by (created_by),
        INDEX idx_type (type),
        INDEX idx_facebook_group (facebook_group_id),
        CONSTRAINT fk_invite_creator FOREIGN KEY (created_by) REFERENCES users(id),
        CONSTRAINT fk_invite_city FOREIGN KEY (city_id) REFERENCES cities(id),
        CONSTRAINT fk_invite_fbgroup FOREIGN KEY (facebook_group_id)
          REFERENCES facebook_group_config(id),
        CONSTRAINT fk_invite_redeemed_by FOREIGN KEY (redeemed_by) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      ALTER TABLE users
        ADD CONSTRAINT fk_users_invite FOREIGN KEY (invite_id) REFERENCES invites(id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP FOREIGN KEY fk_users_invite`);
    await queryRunner.query(`DROP TABLE IF EXISTS invites`);
  }
}
