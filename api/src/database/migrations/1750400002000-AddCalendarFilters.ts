import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCalendarFilters1750400002000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN calendar_city_filter ENUM('all','city') NOT NULL DEFAULT 'all',
        ADD COLUMN calendar_rsvp_only TINYINT(1) NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN calendar_city_filter,
        DROP COLUMN calendar_rsvp_only
    `);
  }
}
