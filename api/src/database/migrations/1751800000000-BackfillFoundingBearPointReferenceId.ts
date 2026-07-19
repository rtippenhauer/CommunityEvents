import { MigrationInterface, QueryRunner } from 'typeorm';

// ResetAndBackfillAchievements (1750900000000) batch-inserted the Founding
// Bear bonus point for every active member via raw SQL, leaving
// member_points.reference_id NULL instead of pointing at the achievement
// row -- the one place in the codebase where an 'achievement'-type point
// isn't traceable back to its achievement (AchievementsService.grant()
// always sets it). That NULL is what a member's points-history audit list
// falls back to a generic "Achievement unlocked" label for. Backfilling it
// makes those rows resolve to the real "Founding Bear" name like every
// other achievement-type point does.
export class BackfillFoundingBearPointReferenceId1751800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE member_points mp
      JOIN achievements a ON a.\`key\` = 'founding_bear'
      SET mp.reference_id = a.id
      WHERE mp.point_type = 'achievement' AND mp.reference_id IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE member_points mp
      JOIN achievements a ON a.\`key\` = 'founding_bear'
      SET mp.reference_id = NULL
      WHERE mp.point_type = 'achievement' AND mp.reference_id = a.id
    `);
  }
}
