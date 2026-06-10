import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceGmailWithResend1749000019000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE email_provider_config
        CHANGE COLUMN gmail_overflow_enabled resend_overflow_enabled TINYINT(1) NOT NULL DEFAULT 0,
        CHANGE COLUMN gmail_daily_limit      resend_daily_limit      INT NOT NULL DEFAULT 1000,
        CHANGE COLUMN gmail_sent_today       resend_sent_today       INT NOT NULL DEFAULT 0,
        CHANGE COLUMN gmail_from_email       resend_from_email       VARCHAR(255) NULL,
        CHANGE COLUMN gmail_from_name        resend_from_name        VARCHAR(200) NULL,
        DROP COLUMN gmail_user,
        DROP COLUMN gmail_app_password,
        ADD COLUMN  resend_api_key           VARCHAR(500) NULL AFTER brevo_from_name
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE email_provider_config
        CHANGE COLUMN resend_overflow_enabled gmail_overflow_enabled TINYINT(1) NOT NULL DEFAULT 0,
        CHANGE COLUMN resend_daily_limit      gmail_daily_limit      INT NOT NULL DEFAULT 500,
        CHANGE COLUMN resend_sent_today       gmail_sent_today       INT NOT NULL DEFAULT 0,
        CHANGE COLUMN resend_from_email       gmail_from_email       VARCHAR(255) NULL,
        CHANGE COLUMN resend_from_name        gmail_from_name        VARCHAR(200) NULL,
        DROP COLUMN resend_api_key,
        ADD COLUMN gmail_user          VARCHAR(255) NULL,
        ADD COLUMN gmail_app_password  VARCHAR(500) NULL
    `);
  }
}
