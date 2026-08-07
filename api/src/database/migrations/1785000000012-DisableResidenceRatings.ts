import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 37. Rating someone's private home doesn't make sense, so residences
// stop being rateable everywhere.
//
// The mechanism already existed — Phase 33 shipped `feature_ratings_residences`
// as an admin toggle, defaulting to 'true' to preserve the behavior of the day.
// This flips that default to 'false' for new forks (see FEATURE_DEFAULTS in
// app-config.service.ts) and turns it off on instances already running.
//
// It also DELETES ratings already recorded against residence locations, which
// is destructive and NOT reversible by down(). Deliberate: the point is that
// this data shouldn't exist, not merely that no more should be added.
//
// What it deliberately does NOT touch: the `member_points` rows those ratings
// earned (pointType RATING, 1 point each, referenceId = location id) and any
// rating-count achievements they unlocked. Members keep points they legitimately
// earned — a policy change about residences is no reason to silently shrink
// someone's total on the leaderboard. The ledger keeps RATING rows pointing at
// residences whose ratings are gone; that is internally untidy but invisible and
// harmless, and it is the reversible choice. Purging them would be a separate,
// deliberate decision.
export class DisableResidenceRatings1785000000012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Turn the toggle off on this instance. Uses UPDATE rather than upsert so
    // an instance that somehow lacks the row is left to the Phase 33 seed.
    await queryRunner.query(
      `UPDATE app_config SET config_value = 'false' WHERE config_key = 'feature_ratings_residences'`,
    );

    // Count first, purely so the deletion leaves a trace in the container logs —
    // there is no way to recover these rows afterward.
    const [{ n }] = (await queryRunner.query(
      `SELECT COUNT(*) AS n FROM location_ratings lr
       JOIN locations l ON l.id = lr.location_id
       WHERE l.is_residence = 1`,
    )) as Array<{ n: number }>;

    if (Number(n) > 0) {
      console.log(
        `[DisableResidenceRatings] deleting ${n} rating(s) recorded against residence locations (irreversible)`,
      );
      await queryRunner.query(
        `DELETE lr FROM location_ratings lr
         JOIN locations l ON l.id = lr.location_id
         WHERE l.is_residence = 1`,
      );
    } else {
      console.log('[DisableResidenceRatings] no residence ratings to delete');
    }
  }

  // Restores the toggle only. The deleted ratings are gone for good — there is
  // no archive table to restore them from, by design.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE app_config SET config_value = 'true' WHERE config_key = 'feature_ratings_residences'`,
    );
  }
}
