import { MigrationInterface, QueryRunner } from 'typeorm';

// Founding Bear goes from 1 point to 20 -- it should feel special, since it
// can only ever be earned by members who joined before the points system
// launched and can never be earned again. Re-syncs every already-earned
// member_points row to match, same as clicking "Recalculate Points" in the
// admin UI would (see AchievementsService.adminRecalculatePoints) -- this
// only works correctly because 1751800000000 already backfilled those
// rows' previously-NULL reference_id.
export class FoundingBearTwentyPoints1751900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE achievements SET points = 20 WHERE \`key\` = 'founding_bear'
    `);
    await queryRunner.query(`
      UPDATE member_points mp
      JOIN achievements a ON a.id = mp.reference_id
      SET mp.points = a.points
      WHERE mp.point_type = 'achievement' AND a.\`key\` = 'founding_bear' AND mp.points <> a.points
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE member_points mp
      JOIN achievements a ON a.id = mp.reference_id
      SET mp.points = 1
      WHERE mp.point_type = 'achievement' AND a.\`key\` = 'founding_bear' AND mp.points = 20
    `);
    await queryRunner.query(`
      UPDATE achievements SET points = 1 WHERE \`key\` = 'founding_bear'
    `);
  }
}
