import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCitiesAndAppConfig1749000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE cities (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        subdomain VARCHAR(50) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_subdomain (subdomain)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      INSERT INTO cities (name, subdomain) VALUES
        ('Cincinnati', 'cincinnati'),
        ('Dayton', 'dayton')
    `);

    await queryRunner.query(`
      CREATE TABLE app_config (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        config_key VARCHAR(100) NOT NULL,
        config_value TEXT NOT NULL,
        description VARCHAR(500) NULL,
        updated_by INT UNSIGNED NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_config_key (config_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      INSERT INTO app_config (config_key, config_value, description) VALUES
        ('event_standard_description', '', 'Standard description appended to all events'),
        ('invite_expiry_member_hours', '48', 'Hours before a member invite expires'),
        ('invite_expiry_campaign_days', '30', 'Days before a campaign invite expires'),
        ('guest_rsvp_enabled', 'true', 'Whether guests can RSVP without an account'),
        ('inactivity_warning_1_days', '60', 'Days of inactivity before first re-engagement email'),
        ('inactivity_warning_2_days', '90', 'Days of inactivity before final warning email'),
        ('inactivity_soft_delete_days', '120', 'Days of inactivity before soft delete'),
        ('inactivity_hard_delete_days', '150', 'Days of inactivity before hard delete'),
        ('max_additional_guests', '9', 'Maximum additional guests per RSVP'),
        ('max_facebook_groups', '3', 'Maximum configured Facebook groups')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS app_config`);
    await queryRunner.query(`DROP TABLE IF EXISTS cities`);
  }
}
