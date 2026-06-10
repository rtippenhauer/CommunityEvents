import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixNotificationPreferencesColumns1749000020000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add any columns that may be missing from an earlier version of the table
    const cols: [string, string][] = [
      ['email_verification', 'TINYINT(1) NOT NULL DEFAULT 1'],
      ['email_password_reset', 'TINYINT(1) NOT NULL DEFAULT 1'],
      ['email_password_changed', 'TINYINT(1) NOT NULL DEFAULT 1'],
    ];

    for (const [col, def] of cols) {
      const [rows] = await queryRunner.query(
        `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notification_preferences' AND COLUMN_NAME = ?`,
        [col],
      );
      if ((rows as { cnt: number }).cnt === 0) {
        await queryRunner.query(
          `ALTER TABLE notification_preferences ADD COLUMN ${col} ${def}`,
        );
      }
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No rollback — removing these columns would destroy data
  }
}
