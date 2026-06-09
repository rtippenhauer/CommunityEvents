import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateNotificationPreferences1749000015000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notification_preferences (
        id                        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id                   INT UNSIGNED NOT NULL UNIQUE,
        email_invite              TINYINT(1) NOT NULL DEFAULT 1,
        email_verification        TINYINT(1) NOT NULL DEFAULT 1,
        email_password_reset      TINYINT(1) NOT NULL DEFAULT 1,
        email_password_changed    TINYINT(1) NOT NULL DEFAULT 1,
        email_security_alert      TINYINT(1) NOT NULL DEFAULT 1,
        email_event_published     TINYINT(1) NOT NULL DEFAULT 1,
        email_rsvp_confirmation   TINYINT(1) NOT NULL DEFAULT 1,
        email_event_reminder      TINYINT(1) NOT NULL DEFAULT 1,
        email_account_deletion    TINYINT(1) NOT NULL DEFAULT 1,
        email_reengagement        TINYINT(1) NOT NULL DEFAULT 1,
        push_event_published      TINYINT(1) NOT NULL DEFAULT 1,
        push_event_reminder       TINYINT(1) NOT NULL DEFAULT 1,
        push_announcement         TINYINT(1) NOT NULL DEFAULT 1,
        updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_notif_pref_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      INSERT INTO notification_preferences (user_id)
      SELECT id FROM users WHERE status != 'deleted'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS notification_preferences`);
  }
}
