import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase105AccountDeletion1749400000000 implements MigrationInterface {
  name = 'Phase105AccountDeletion1749400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // facebook_deletion_requests table
    await queryRunner.query(`
      CREATE TABLE \`facebook_deletion_requests\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`facebook_user_id\` VARCHAR(255) NOT NULL,
        \`confirmation_code\` VARCHAR(100) NOT NULL,
        \`dinnerbears_user_id\` INT UNSIGNED NULL,
        \`status\` ENUM('pending','completed') NOT NULL DEFAULT 'pending',
        \`requested_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`completed_at\` DATETIME NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_fb_deletion_code\` (\`confirmation_code\`),
        KEY \`IDX_fb_deletion_user_id\` (\`facebook_user_id\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // New email template columns on email_provider_config
    await queryRunner.query(`
      ALTER TABLE \`email_provider_config\`
        ADD COLUMN \`tmpl_provider_disconnected\` INT UNSIGNED NULL AFTER \`tmpl_password_reset\`,
        ADD COLUMN \`tmpl_account_deleted\` INT UNSIGNED NULL AFTER \`tmpl_provider_disconnected\`
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE \`email_provider_config\`
        DROP COLUMN \`tmpl_account_deleted\`,
        DROP COLUMN \`tmpl_provider_disconnected\`
    `);
    await queryRunner.query(`DROP TABLE \`facebook_deletion_requests\``);
  }
}
