import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 35 (membership fee): tracks whether a member has paid dues and when
// that membership expires. Memberships always run calendar-year (expire
// Jan 1 of the following year, regardless of when paid — set server-side in
// AdminService.setMembership, not here). Enforcement (RSVP blocking once a
// member's free first meeting is used) lives in EventsService.upsertRsvp,
// gated by the feature_require_membership toggle (see SeedRequireMembershipToggle).
export class AddMembershipToUsers1785000000008 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.query(
      `SELECT COUNT(*) AS n FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'has_membership'`,
    );
    if (Number(existing[0]?.n ?? 0) > 0) return; // already added

    await queryRunner.query(
      `ALTER TABLE users
         ADD COLUMN has_membership TINYINT(1) NOT NULL DEFAULT 0 AFTER role,
         ADD COLUMN membership_expires_at DATETIME NULL AFTER has_membership`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN has_membership, DROP COLUMN membership_expires_at`,
    );
  }
}
