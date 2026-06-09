import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailCredentialsToConfig1749000016000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE email_provider_config
        ADD COLUMN brevo_api_key        VARCHAR(500)  NULL AFTER gmail_sent_today,
        ADD COLUMN brevo_from_email     VARCHAR(255)  NULL AFTER brevo_api_key,
        ADD COLUMN brevo_from_name      VARCHAR(200)  NULL AFTER brevo_from_email,
        ADD COLUMN gmail_user           VARCHAR(255)  NULL AFTER brevo_from_name,
        ADD COLUMN gmail_app_password   VARCHAR(500)  NULL AFTER gmail_user,
        ADD COLUMN gmail_from_email     VARCHAR(255)  NULL AFTER gmail_app_password,
        ADD COLUMN gmail_from_name      VARCHAR(200)  NULL AFTER gmail_from_email,
        ADD COLUMN tmpl_invite                  INT UNSIGNED NULL AFTER gmail_from_name,
        ADD COLUMN tmpl_security_alert          INT UNSIGNED NULL AFTER tmpl_invite,
        ADD COLUMN tmpl_event_published         INT UNSIGNED NULL AFTER tmpl_security_alert,
        ADD COLUMN tmpl_rsvp_confirmation       INT UNSIGNED NULL AFTER tmpl_event_published,
        ADD COLUMN tmpl_event_reminder          INT UNSIGNED NULL AFTER tmpl_rsvp_confirmation,
        ADD COLUMN tmpl_account_deletion        INT UNSIGNED NULL AFTER tmpl_event_reminder,
        ADD COLUMN tmpl_reengagement_60         INT UNSIGNED NULL AFTER tmpl_account_deletion,
        ADD COLUMN tmpl_reengagement_90         INT UNSIGNED NULL AFTER tmpl_reengagement_60,
        ADD COLUMN tmpl_guest_rsvp_confirmation INT UNSIGNED NULL AFTER tmpl_reengagement_90,
        ADD COLUMN tmpl_email_verification      INT UNSIGNED NULL AFTER tmpl_guest_rsvp_confirmation,
        ADD COLUMN tmpl_password_reset          INT UNSIGNED NULL AFTER tmpl_email_verification
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE email_provider_config
        DROP COLUMN tmpl_password_reset,
        DROP COLUMN tmpl_email_verification,
        DROP COLUMN tmpl_guest_rsvp_confirmation,
        DROP COLUMN tmpl_reengagement_90,
        DROP COLUMN tmpl_reengagement_60,
        DROP COLUMN tmpl_account_deletion,
        DROP COLUMN tmpl_event_reminder,
        DROP COLUMN tmpl_rsvp_confirmation,
        DROP COLUMN tmpl_event_published,
        DROP COLUMN tmpl_security_alert,
        DROP COLUMN tmpl_invite,
        DROP COLUMN gmail_from_name,
        DROP COLUMN gmail_from_email,
        DROP COLUMN gmail_app_password,
        DROP COLUMN gmail_user,
        DROP COLUMN brevo_from_name,
        DROP COLUMN brevo_from_email,
        DROP COLUMN brevo_api_key
    `);
  }
}
