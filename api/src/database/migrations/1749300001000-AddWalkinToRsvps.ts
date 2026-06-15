import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWalkinToRsvps1749300001000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE event_rsvps ADD COLUMN is_walkin TINYINT(1) NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE event_rsvps DROP COLUMN is_walkin`);
  }
}
