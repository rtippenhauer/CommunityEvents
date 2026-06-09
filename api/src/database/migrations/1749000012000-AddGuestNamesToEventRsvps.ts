import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGuestNamesToEventRsvps1749000012000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE event_rsvps
        ADD COLUMN guest_names JSON NULL AFTER additional_guests
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE event_rsvps DROP COLUMN guest_names`);
  }
}
