import { MigrationInterface, QueryRunner } from 'typeorm';

export class ResetAndBackfillAchievements1750900000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Full achievement/points reset and clean backfill.
    // Effective date for real event data: 2026-06-24.

    // 1. Wipe all earned achievements, points, and titles
    await runner.query(`DELETE FROM member_achievements`);
    await runner.query(`DELETE FROM member_points`);
    await runner.query(`UPDATE users SET selected_title = NULL WHERE selected_title IS NOT NULL`);

    // 2. Remove the 3-city Road Tripper tier — city hopper ladder is 1/5/10/25/50/100
    await runner.query(`DELETE FROM achievements WHERE \`key\` = 'city_hopper_3'`);

    // 3. Grant Founding Bear achievement to all active members
    await runner.query(`
      INSERT INTO member_achievements (member_id, achievement_id, earned_at)
      SELECT u.id, a.id, NOW()
      FROM users u
      JOIN achievements a ON a.\`key\` = 'founding_bear'
      WHERE u.status = 'active'
    `);

    // 4. Award 1 Bear Point (achievement type) for Founding Bear
    await runner.query(`
      INSERT INTO member_points (user_id, point_type, reference_id, points, awarded_at)
      SELECT u.id, 'achievement', NULL, 1, NOW()
      FROM users u
      WHERE u.status = 'active'
    `);

    // 5. Award attendance points for events on or after 2026-06-24
    await runner.query(`
      INSERT INTO member_points (user_id, point_type, reference_id, points, awarded_at)
      SELECT r.user_id, 'attendance', r.event_id, 1, e.event_date
      FROM event_rsvps r
      JOIN events e ON e.id = r.event_id
      WHERE r.attended = 1
        AND e.event_date >= '2026-06-24'
    `);

    // 6. Award city hopper points for other-city attendance on or after 2026-06-24
    await runner.query(`
      INSERT INTO member_points (user_id, point_type, reference_id, points, awarded_at)
      SELECT r.user_id, 'city_hopper', r.event_id, 1, e.event_date
      FROM event_rsvps r
      JOIN events e ON e.id = r.event_id
      WHERE r.attended = 1
        AND r.from_other_city = 1
        AND e.event_date >= '2026-06-24'
    `);

    // 7. Grant attendance achievements based on real counts
    await runner.query(`
      INSERT IGNORE INTO member_achievements (member_id, achievement_id, earned_at)
      SELECT counts.user_id, a.id, NOW()
      FROM (
        SELECT user_id, COUNT(*) AS cnt
        FROM member_points
        WHERE point_type = 'attendance'
        GROUP BY user_id
      ) counts
      JOIN achievements a ON a.progress_type = 'attendance' AND a.progress_target <= counts.cnt
    `);

    // 8. Grant city hopper achievements based on real counts
    await runner.query(`
      INSERT IGNORE INTO member_achievements (member_id, achievement_id, earned_at)
      SELECT counts.user_id, a.id, NOW()
      FROM (
        SELECT user_id, COUNT(*) AS cnt
        FROM member_points
        WHERE point_type = 'city_hopper'
        GROUP BY user_id
      ) counts
      JOIN achievements a ON a.progress_type = 'city_hopper' AND a.progress_target <= counts.cnt
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    // Cannot meaningfully reverse a data reset.
    // Restore the Road Tripper tier definition at minimum.
    await runner.query(`
      INSERT IGNORE INTO achievements (\`key\`, name, description, icon, progress_type, progress_target, points, title, is_secret)
      VALUES ('city_hopper_3', 'Road Tripper', 'Attended dinners in 3 different cities.', 'directions_car', 'city_hopper', 3, 5, 'Road Tripper', 0)
    `);
  }
}
