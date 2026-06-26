import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReservationConfirmedNote1750300002000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE events
        ADD COLUMN reservation_confirmed_note VARCHAR(500) NULL DEFAULT NULL AFTER reservation_confirmed_at
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE events DROP COLUMN reservation_confirmed_note`);
  }
}
