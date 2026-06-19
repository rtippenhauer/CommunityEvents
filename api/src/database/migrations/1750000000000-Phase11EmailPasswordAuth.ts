import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase11EmailPasswordAuth1750000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN email_verification_token VARCHAR(255) NULL AFTER password_hash,
        ADD COLUMN email_verification_expires_at DATETIME NULL AFTER email_verification_token,
        ADD COLUMN password_reset_token VARCHAR(255) NULL AFTER email_verification_expires_at,
        ADD COLUMN password_reset_expires_at DATETIME NULL AFTER password_reset_token
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN email_verification_token,
        DROP COLUMN email_verification_expires_at,
        DROP COLUMN password_reset_token,
        DROP COLUMN password_reset_expires_at
    `);
  }
}
