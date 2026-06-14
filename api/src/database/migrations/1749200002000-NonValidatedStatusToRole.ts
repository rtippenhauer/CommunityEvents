import { MigrationInterface, QueryRunner } from 'typeorm';

export class NonValidatedStatusToRole1749200002000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Expand role enum to include non_validated
    await queryRunner.query(`
      ALTER TABLE users
        MODIFY COLUMN role ENUM('non_validated','member','moderator','admin')
        NOT NULL DEFAULT 'member'
    `);

    // 2. Move non_validated users: set role, clear status
    await queryRunner.query(`
      UPDATE users SET role = 'non_validated', status = 'active'
      WHERE status = 'non_validated'
    `);

    // 3. Shrink status enum — non_validated no longer a valid status
    await queryRunner.query(`
      ALTER TABLE users
        MODIFY COLUMN status ENUM('active','suspended','deleted')
        NOT NULL DEFAULT 'active'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Restore non_validated to status enum
    await queryRunner.query(`
      ALTER TABLE users
        MODIFY COLUMN status ENUM('active','suspended','deleted','non_validated')
        NOT NULL DEFAULT 'active'
    `);

    // Move back: set status, clear role back to member
    await queryRunner.query(`
      UPDATE users SET status = 'non_validated', role = 'member'
      WHERE role = 'non_validated'
    `);

    // Shrink role enum back
    await queryRunner.query(`
      ALTER TABLE users
        MODIFY COLUMN role ENUM('member','moderator','admin')
        NOT NULL DEFAULT 'member'
    `);
  }
}
