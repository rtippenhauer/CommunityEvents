import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSourceToGuestLinks1749000022000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE event_guest_links
        MODIFY COLUMN member_rsvp_id INT UNSIGNED NULL,
        MODIFY COLUMN created_by INT UNSIGNED NULL,
        ADD COLUMN source ENUM('member','public') NOT NULL DEFAULT 'member' AFTER delivery_type
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`
      ALTER TABLE event_guest_links
        DROP COLUMN source,
        MODIFY COLUMN member_rsvp_id INT UNSIGNED NOT NULL,
        MODIFY COLUMN created_by INT UNSIGNED NOT NULL
    `);
  }
}
