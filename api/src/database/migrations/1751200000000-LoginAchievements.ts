import { MigrationInterface, QueryRunner } from 'typeorm';

export class LoginAchievements1751200000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Track "site access" logins (deduped by a time window) separately from
    // the existing auth-event-based login_count/last_login_at.
    await runner.query(`
      ALTER TABLE users
        ADD COLUMN qualifying_login_count INT UNSIGNED NOT NULL DEFAULT 0,
        ADD COLUMN last_qualifying_login_at DATETIME NULL DEFAULT NULL
    `);

    // Lets the frontend show a one-time splash the first time a member sees
    // a newly-earned achievement, instead of only ever appearing silently.
    await runner.query(`
      ALTER TABLE member_achievements
        ADD COLUMN seen_at DATETIME NULL DEFAULT NULL
    `);

    // Achievements already earned before this feature shipped shouldn't
    // suddenly trigger a splash — only newly-earned ones should.
    await runner.query(`UPDATE member_achievements SET seen_at = earned_at WHERE seen_at IS NULL`);

    await runner.query(`
      ALTER TABLE achievements
        MODIFY COLUMN progress_type
          ENUM('attendance','coordinator','new_restaurant_coordinator','invite','rating',
               'founding','event','city_hopper','secret_dinner','login') NULL
    `);

    await runner.query(`
      INSERT INTO achievements
        (\`key\`, name, description, icon, progress_type, progress_target, points, title, is_secret)
      VALUES
        ('login_25', 'Familiar Face',
         'Visited DinnerBears 25 times.',
         'login', 'login', 25, 10, NULL, 1),

        ('login_50', 'Regular Visitor',
         'Visited DinnerBears 50 times.',
         'verified', 'login', 50, 10, 'Regular Visitor', 1),

        ('login_100', 'Dedicated Bear',
         'Visited DinnerBears 100 times.',
         'military_tech', 'login', 100, 10, 'Dedicated Bear', 1),

        ('login_250', 'Devoted Bear',
         'Visited DinnerBears 250 times.',
         'workspace_premium', 'login', 250, 10, 'Devoted Bear', 1),

        ('login_500', 'DinnerBears Superfan',
         'Visited DinnerBears 500 times. We should start paying rent.',
         'emoji_events', 'login', 500, 10, 'DinnerBears Superfan', 1),

        ('patriotic_bear', 'Patriotic Bear',
         'Logged in during the DinnerBears Independence Day week (July 4-11, 2026).',
         'celebration', NULL, NULL, 10, NULL, 1)
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DELETE FROM achievements WHERE \`key\` IN ('login_25','login_50','login_100','login_250','login_500','patriotic_bear')
    `);
    await runner.query(`
      ALTER TABLE achievements
        MODIFY COLUMN progress_type
          ENUM('attendance','coordinator','new_restaurant_coordinator','invite','rating',
               'founding','event','city_hopper','secret_dinner') NULL
    `);
    await runner.query(`ALTER TABLE member_achievements DROP COLUMN seen_at`);
    await runner.query(`
      ALTER TABLE users
        DROP COLUMN qualifying_login_count,
        DROP COLUMN last_qualifying_login_at
    `);
  }
}
