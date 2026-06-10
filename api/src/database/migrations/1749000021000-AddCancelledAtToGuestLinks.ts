import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCancelledAtToGuestLinks1749000021000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE event_guest_links ADD COLUMN cancelled_at DATETIME NULL AFTER used_at`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE event_guest_links DROP COLUMN cancelled_at`,
    );
  }
}
