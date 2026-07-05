import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the 'automation' role and seeds one dedicated user row for Claude
// Code automation (release drafting, feedback triage). Never impersonates
// Rob's real admin account — this is a separate, real user with its own
// narrow role, reassignable to member/moderator/admin later if broader
// access is needed for testing.
export class AddAutomationRole1751400000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE users
        MODIFY COLUMN role ENUM('non_validated','member','moderator','admin','automation')
        NOT NULL DEFAULT 'member'
    `);

    const [city] = await runner.query(`SELECT id FROM cities ORDER BY id LIMIT 1`);

    await runner.query(
      `
      INSERT INTO users (full_name, email, email_status, email_verified_at, password_hash, city_id, role, status, created_at, updated_at)
      VALUES (?, ?, 'active', NOW(), NULL, ?, 'automation', 'active', NOW(), NOW())
      `,
      ['Claude Automation', 'automation@dinnerbears.internal', city.id],
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DELETE FROM users WHERE email = 'automation@dinnerbears.internal'`);
    await runner.query(`
      ALTER TABLE users
        MODIFY COLUMN role ENUM('non_validated','member','moderator','admin')
        NOT NULL DEFAULT 'member'
    `);
  }
}
