import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase15AchievementEnhancements1750500002000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Add image path, progress tracking, and event-specific support
    await runner.query(`
      ALTER TABLE achievements
        ADD COLUMN image_path    VARCHAR(500)  NULL DEFAULT NULL AFTER icon,
        ADD COLUMN progress_type ENUM('attendance','coordinator','new_restaurant_coordinator','invite','rating','founding','event') NULL DEFAULT NULL AFTER image_path,
        ADD COLUMN progress_target INT UNSIGNED NULL DEFAULT NULL AFTER progress_type,
        ADD COLUMN event_id      INT UNSIGNED  NULL DEFAULT NULL AFTER progress_target,
        ADD COLUMN points        TINYINT       NOT NULL DEFAULT 0  AFTER event_id,
        ADD CONSTRAINT fk_achievements_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE SET NULL
    `);

    // Set progress_type + target for seeded achievements
    await runner.query(`
      UPDATE achievements SET progress_type = 'founding', progress_target = 1, points = 1 WHERE \`key\` = 'founding_bear'
    `);
    await runner.query(`
      UPDATE achievements SET progress_type = 'attendance', progress_target = 1 WHERE \`key\` = 'first_dinner'
    `);
    await runner.query(`
      UPDATE achievements SET progress_type = 'attendance', progress_target = 5 WHERE \`key\` = 'regular'
    `);
    await runner.query(`
      UPDATE achievements SET progress_type = 'attendance', progress_target = 25 WHERE \`key\` = 'veteran'
    `);
    await runner.query(`
      UPDATE achievements SET progress_type = 'coordinator', progress_target = 1 WHERE \`key\` = 'first_coordinator'
    `);
    await runner.query(`
      UPDATE achievements SET progress_type = 'new_restaurant_coordinator', progress_target = 3 WHERE \`key\` = 'scout'
    `);
    await runner.query(`
      UPDATE achievements SET progress_type = 'invite', progress_target = 1 WHERE \`key\` = 'connector'
    `);
    await runner.query(`
      UPDATE achievements SET progress_type = 'rating', progress_target = 5 WHERE \`key\` = 'critic'
    `);

    // Award 1 Bear Point to all Founding Bear holders
    await runner.query(`
      INSERT INTO member_points (user_id, point_type, reference_id, points, awarded_at)
      SELECT ma.member_id, 'attendance', NULL, 1, NOW()
      FROM member_achievements ma
      JOIN achievements a ON a.id = ma.achievement_id AND a.\`key\` = 'founding_bear'
      WHERE NOT EXISTS (
        SELECT 1 FROM member_points mp
        WHERE mp.user_id = ma.member_id AND mp.point_type = 'attendance' AND mp.reference_id IS NULL
      )
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE achievements DROP FOREIGN KEY fk_achievements_event`);
    await runner.query(`
      ALTER TABLE achievements
        DROP COLUMN points,
        DROP COLUMN event_id,
        DROP COLUMN progress_target,
        DROP COLUMN progress_type,
        DROP COLUMN image_path
    `);
  }
}
