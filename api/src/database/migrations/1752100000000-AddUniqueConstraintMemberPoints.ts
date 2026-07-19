import { MigrationInterface, QueryRunner } from 'typeorm';

// member_points had no constraint stopping the same (user, point_type,
// reference_id) from being awarded twice -- application-level EXISTS
// checks in PointsService/AchievementsService are the only thing that
// ever prevented a duplicate. That's how 1752000000000's duplicates
// happened in the first place: adminRecalculatePoints' "does this member
// already have a points row for this achievement" check is keyed on
// reference_id, and a NULL reference_id (the original bug backfilled by
// 1751800000000) never matches an equality, so it inserted a *second*
// row with the real reference_id instead of finding the first one. A
// unique constraint alone doesn't close that -- NULL and a real id are
// different values, so it wouldn't have stopped this specific collision
// either. Making reference_id NOT NULL is what actually prevents a
// repeat: every real award path already always supplies one (see
// PointsService's awardAttendance/awardCoordinator/awardRating/etc. and
// AchievementsService.grant()), so this was only ever nullable to
// accommodate that one raw-SQL migration.
//
// The dedupe step re-runs 1752000000000's cleanup defensively so this
// migration can't fail even if some other duplicate exists that we
// don't know about; the unique key is then belt-and-suspenders against
// any future exact-duplicate insert, the same way uq_member_achievement
// already guards member_achievements (see 1750500000000-Phase15Points).
export class AddUniqueConstraintMemberPoints1752100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE mp1 FROM member_points mp1
      JOIN member_points mp2
        ON mp1.user_id = mp2.user_id
        AND mp1.point_type = mp2.point_type
        AND mp1.reference_id = mp2.reference_id
        AND mp1.id > mp2.id
    `);
    await queryRunner.query(`
      ALTER TABLE member_points
        MODIFY COLUMN reference_id INT UNSIGNED NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE member_points
        ADD UNIQUE KEY uq_member_points_user_type_ref (user_id, point_type, reference_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE member_points
        DROP INDEX uq_member_points_user_type_ref
    `);
    await queryRunner.query(`
      ALTER TABLE member_points
        MODIFY COLUMN reference_id INT UNSIGNED NULL DEFAULT NULL
    `);
  }
}
