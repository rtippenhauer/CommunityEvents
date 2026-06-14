import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase8RestaurantModFields1749200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE restaurants
        ADD COLUMN moderator_notes LONGTEXT NULL,
        ADD COLUMN contact_name VARCHAR(100) NULL,
        ADD COLUMN contact_phone VARCHAR(30) NULL,
        ADD COLUMN contact_email VARCHAR(150) NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE restaurants
        DROP COLUMN moderator_notes,
        DROP COLUMN contact_name,
        DROP COLUMN contact_phone,
        DROP COLUMN contact_email
    `);
  }
}
