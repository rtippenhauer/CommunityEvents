import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoginLockout1750200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users
        ADD COLUMN failed_login_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER login_count,
        ADD COLUMN login_locked_until DATETIME NULL AFTER failed_login_attempts,
        ADD COLUMN last_failed_login_at DATETIME NULL AFTER login_locked_until`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users
        DROP COLUMN last_failed_login_at,
        DROP COLUMN login_locked_until,
        DROP COLUMN failed_login_attempts`,
    );
  }
}
