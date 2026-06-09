import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEventGuestLinks1749000013000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE event_guest_links (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        event_id INT UNSIGNED NOT NULL,
        created_by INT UNSIGNED NOT NULL,
        member_rsvp_id INT UNSIGNED NOT NULL,
        delivery_type ENUM('email','shareable') NOT NULL DEFAULT 'shareable',
        recipient_name VARCHAR(200) NULL,
        recipient_email VARCHAR(255) NULL,
        token VARCHAR(100) NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_token (token),
        INDEX idx_event (event_id),
        INDEX idx_rsvp (member_rsvp_id),
        INDEX idx_created_by (created_by),
        CONSTRAINT fk_guestlink_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        CONSTRAINT fk_guestlink_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_guestlink_rsvp FOREIGN KEY (member_rsvp_id) REFERENCES event_rsvps(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE event_guest_links`);
  }
}
