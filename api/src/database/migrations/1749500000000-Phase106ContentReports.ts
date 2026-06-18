import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase106ContentReports1749500000000 implements MigrationInterface {
  name = 'Phase106ContentReports1749500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE \`content_reports\` (
        \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`reporter_id\` INT UNSIGNED NOT NULL,
        \`content_type\` ENUM('event_comment','event_comment_reply','announcement_comment','restaurant_rating') NOT NULL,
        \`content_id\` INT UNSIGNED NOT NULL,
        \`reason\` VARCHAR(500) NULL,
        \`status\` ENUM('pending','reviewed','dismissed') NOT NULL DEFAULT 'pending',
        \`reviewed_by\` INT UNSIGNED NULL,
        \`reviewed_at\` DATETIME NULL,
        \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`UQ_report_per_member\` (\`reporter_id\`, \`content_type\`, \`content_id\`),
        KEY \`IDX_report_status\` (\`status\`),
        CONSTRAINT \`FK_report_reporter\` FOREIGN KEY (\`reporter_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE,
        CONSTRAINT \`FK_report_reviewer\` FOREIGN KEY (\`reviewed_by\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE \`content_reports\``);
  }
}
