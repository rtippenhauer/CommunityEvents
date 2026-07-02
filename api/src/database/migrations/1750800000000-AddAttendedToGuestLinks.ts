import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAttendedToGuestLinks1750800000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE event_guest_links
        ADD COLUMN attended TINYINT(1) NULL DEFAULT NULL AFTER cancelled_at
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE event_guest_links DROP COLUMN attended`);
  }
}
