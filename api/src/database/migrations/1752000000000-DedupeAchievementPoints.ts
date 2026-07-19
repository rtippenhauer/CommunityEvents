import { MigrationInterface, QueryRunner } from 'typeorm';

// Fallout from 1751800000000: while the Founding Bear bonus-point rows still
// had reference_id NULL, AchievementsService.adminRecalculatePoints()'s
// "insert a points row for any earned achievement missing one" query
// couldn't see them (its NOT EXISTS check matches on reference_id, and NULL
// never matches an equality), so running "Recalculate Points" in the admin
// UI in that window inserted a *second* achievement-type member_points row
// for every member who already had one. Once reference_id was backfilled,
// both rows correctly resolved to the same achievement and both got bumped
// to 20 by 1751900000000, faithfully reflecting the duplication rather than
// hiding it. This removes the extras, keeping the earliest (lowest id) row
// per (user, achievement) pair.
export class DedupeAchievementPoints1752000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE mp1 FROM member_points mp1
      JOIN member_points mp2
        ON mp1.user_id = mp2.user_id
        AND mp1.reference_id = mp2.reference_id
        AND mp1.point_type = mp2.point_type
        AND mp1.id > mp2.id
      WHERE mp1.point_type = 'achievement'
    `);
  }

  public async down(): Promise<void> {
    // Not reversible -- the deleted rows were exact duplicates, so there's
    // nothing meaningful to restore them from.
  }
}
