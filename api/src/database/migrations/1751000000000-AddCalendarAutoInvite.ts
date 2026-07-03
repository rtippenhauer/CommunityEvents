import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalendarAutoInvite1751000000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN calendar_auto_invite ENUM('none','city','all') NOT NULL DEFAULT 'none'
      AFTER calendar_rsvp_only
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN calendar_auto_invite`);
  }
}
