import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalendarToken1750400000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN calendar_token VARCHAR(36) NULL UNIQUE
          COMMENT 'UUID v4 for iCal feed authentication — independent of session tokens'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN calendar_token`);
  }
}
