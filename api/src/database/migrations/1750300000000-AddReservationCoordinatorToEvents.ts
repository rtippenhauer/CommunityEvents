import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReservationCoordinatorToEvents1750300000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE events
        ADD COLUMN reservation_assignee_id INT UNSIGNED NULL DEFAULT NULL AFTER facebook_share_text,
        ADD COLUMN reservation_contact_name VARCHAR(150) NULL DEFAULT NULL AFTER reservation_assignee_id,
        ADD COLUMN reservation_contact_email VARCHAR(255) NULL DEFAULT NULL AFTER reservation_contact_name,
        ADD COLUMN reservation_confirmed TINYINT(1) NOT NULL DEFAULT 0 AFTER reservation_contact_email,
        ADD COLUMN reservation_confirm_token VARCHAR(64) NULL DEFAULT NULL AFTER reservation_confirmed,
        ADD UNIQUE INDEX uq_events_reservation_token (reservation_confirm_token),
        ADD CONSTRAINT fk_events_reservation_assignee
          FOREIGN KEY (reservation_assignee_id) REFERENCES users (id) ON DELETE SET NULL
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE events
        DROP FOREIGN KEY fk_events_reservation_assignee,
        DROP INDEX uq_events_reservation_token,
        DROP COLUMN reservation_assignee_id,
        DROP COLUMN reservation_contact_name,
        DROP COLUMN reservation_contact_email,
        DROP COLUMN reservation_confirmed,
        DROP COLUMN reservation_confirm_token
    `);
  }
}
