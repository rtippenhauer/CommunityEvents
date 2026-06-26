import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReservationConfirmedBy1750300001000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE events
        ADD COLUMN reservation_confirmed_by VARCHAR(255) NULL DEFAULT NULL AFTER reservation_confirmed,
        ADD COLUMN reservation_confirmed_at DATETIME NULL DEFAULT NULL AFTER reservation_confirmed_by,
        ADD COLUMN reservation_seats_email_sent TINYINT(1) NOT NULL DEFAULT 0 AFTER reservation_confirmed_at
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE events
        DROP COLUMN reservation_confirmed_by,
        DROP COLUMN reservation_confirmed_at,
        DROP COLUMN reservation_seats_email_sent
    `);
  }
}
