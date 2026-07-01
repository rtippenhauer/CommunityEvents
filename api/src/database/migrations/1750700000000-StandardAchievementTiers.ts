import { MigrationInterface, QueryRunner } from 'typeorm';

export class StandardAchievementTiers1750700000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // 1. Add 'achievement' point type for tier-unlock bonuses
    await runner.query(`
      ALTER TABLE member_points
        MODIFY COLUMN point_type
          ENUM('attendance','coordinator','coordinator_new_restaurant','invite','rating',
               'city_hopper','secret_dinner','achievement') NOT NULL
    `);

    // 2. Set all progressive tiers to 5 bonus points
    await runner.query(`
      UPDATE achievements
      SET points = 5
      WHERE progress_type IN
        ('attendance','coordinator','new_restaurant_coordinator','invite','rating','city_hopper','secret_dinner')
    `);

    // 3. Align Scout tier targets to the standard ladder (1 / 5 / 10 / 25 / 50 / 100)
    await runner.query(`UPDATE achievements SET progress_target = 1  WHERE \`key\` = 'scout'`);
    await runner.query(`UPDATE achievements SET progress_target = 5  WHERE \`key\` = 'culinary_explorer'`);
    await runner.query(`UPDATE achievements SET progress_target = 10 WHERE \`key\` = 'trailblazer'`);

    // 4. New Coordinator tier: 100
    await runner.query(`
      INSERT IGNORE INTO achievements
        (\`key\`, name, description, icon, progress_type, progress_target, points, title, is_secret)
      VALUES
        ('legendary_maestro', 'Legendary Maestro',
         'Coordinated reservations for 100 events. DinnerBears simply would not exist without you.',
         'workspace_premium', 'coordinator', 100, 5, 'Legendary Maestro', 0)
    `);

    // 5. New Scout tiers: 25 / 50 / 100
    await runner.query(`
      INSERT IGNORE INTO achievements
        (\`key\`, name, description, icon, progress_type, progress_target, points, title, is_secret)
      VALUES
        ('culinary_pioneer', 'Culinary Pioneer',
         'Brought DinnerBears to 25 restaurants they had never visited. You literally made the map.',
         'map', 'new_restaurant_coordinator', 25, 5, 'Culinary Pioneer', 0),

        ('master_explorer', 'Master Explorer',
         'Discovered 50 restaurants new to DinnerBears. The city is your menu.',
         'public', 'new_restaurant_coordinator', 50, 5, 'Master Explorer', 0),

        ('legendary_scout', 'Legendary Scout',
         'Opened DinnerBears to 100 new restaurants. A true legend of culinary discovery.',
         'emoji_events', 'new_restaurant_coordinator', 100, 5, 'Legendary Scout', 0)
    `);

    // 6. New Invite tiers: 5 / 10 / 25 / 50 / 100
    await runner.query(`
      INSERT IGNORE INTO achievements
        (\`key\`, name, description, icon, progress_type, progress_target, points, title, is_secret)
      VALUES
        ('social_butterfly', 'Social Butterfly',
         'Five of your invitees have attended their first dinner.',
         'groups', 'invite', 5, 5, 'Social Butterfly', 0),

        ('networker', 'Networker',
         'Ten people attended DinnerBears because you invited them.',
         'hub', 'invite', 10, 5, 'Networker', 0),

        ('ambassador', 'Ambassador',
         '25 members traced their first dinner back to you.',
         'emoji_people', 'invite', 25, 5, 'Ambassador', 0),

        ('community_builder', 'Community Builder',
         'You personally brought 50 people into the fold.',
         'foundation', 'invite', 50, 5, 'Community Builder', 0),

        ('legendary_connector', 'Legendary Connector',
         '100 members are here because of you. DinnerBears is your legacy.',
         'diversity_3', 'invite', 100, 5, 'Legendary Connector', 0)
    `);

    // 7. New Rating tiers: 1 / 10 / 25 / 50 / 100  (tier at 5 already exists as 'critic')
    await runner.query(`
      INSERT IGNORE INTO achievements
        (\`key\`, name, description, icon, progress_type, progress_target, points, title, is_secret)
      VALUES
        ('first_review', 'First Review',
         'Submitted your first restaurant rating.',
         'rate_review', 'rating', 1, 5, NULL, 0),

        ('food_connoisseur', 'Food Connoisseur',
         'Submitted 10 restaurant ratings. Your palate is becoming legendary.',
         'restaurant_menu', 'rating', 10, 5, 'Food Connoisseur', 0),

        ('dining_authority', 'Dining Authority',
         'Submitted 25 restaurant ratings. Restaurants should fear your pen.',
         'verified', 'rating', 25, 5, 'Dining Authority', 0),

        ('master_critic', 'Master Critic',
         'Submitted 50 restaurant ratings. You are the Michelin guide of DinnerBears.',
         'reviews', 'rating', 50, 5, 'Master Critic', 0),

        ('legendary_critic', 'Legendary Critic',
         'Submitted 100 restaurant ratings. No fork has escaped your judgement.',
         'grade', 'rating', 100, 5, 'Legendary Critic', 0)
    `);

    // 8. New City Hopper tiers: 25 / 50 / 100  (1 / 3 / 5 / 10 already exist)
    await runner.query(`
      INSERT IGNORE INTO achievements
        (\`key\`, name, description, icon, progress_type, progress_target, points, title, is_secret)
      VALUES
        ('city_hopper_25', 'World Wanderer',
         'Attended DinnerBears dinners in 25 cities.',
         'travel_explore', 'city_hopper', 25, 5, 'World Wanderer', 0),

        ('city_hopper_50', 'Transcontinental Bear',
         'Attended DinnerBears dinners in 50 cities.',
         'language', 'city_hopper', 50, 5, 'Transcontinental Bear', 0),

        ('city_hopper_100', 'Ultimate Globe Trotter',
         'Attended DinnerBears dinners across 100 cities. There is nowhere left to eat.',
         'rocket_launch', 'city_hopper', 100, 5, 'Ultimate Globe Trotter', 0)
    `);

    // 9. New Secret Dinner tiers: 10 / 25 / 50 / 100  (1 / 3 / 5 already exist)
    await runner.query(`
      INSERT IGNORE INTO achievements
        (\`key\`, name, description, icon, progress_type, progress_target, points, title, is_secret)
      VALUES
        ('secret_dinner_10', 'Shadow Veteran',
         'Attended 10 secret DinnerBears dinners.',
         'nights_stay', 'secret_dinner', 10, 5, 'Shadow Veteran', 0),

        ('secret_dinner_25', 'Phantom Diner',
         'Attended 25 secret DinnerBears dinners. You thrive in the mystery.',
         'psychology', 'secret_dinner', 25, 5, 'Phantom Diner', 0),

        ('secret_dinner_50', 'Mystery Master',
         'Attended 50 secret DinnerBears dinners. You wrote the book on secrecy.',
         'visibility_off', 'secret_dinner', 50, 5, 'Mystery Master', 0),

        ('secret_dinner_100', 'Ultimate Shadow Bear',
         'Attended 100 secret DinnerBears dinners. The restaurants never saw you coming.',
         'bedtime', 'secret_dinner', 100, 5, 'Ultimate Shadow Bear', 0)
    `);

    // 10. Pre-populate member_achievements for all existing members so tiers already
    //     earned before this migration don't retroactively fire the bonus-point grant.
    //     Coordinator is intentionally excluded — it stays retroactive for new accounts.
    const progressTypes = [
      { col: 'attendance',              type: 'attendance' },
      { col: 'invite',                  type: 'invite' },
      { col: 'rating',                  type: 'rating' },
      { col: 'city_hopper',             type: 'city_hopper' },
      { col: 'secret_dinner',           type: 'secret_dinner' },
      { col: 'coordinator_new_restaurant', type: 'new_restaurant_coordinator' },
    ];
    for (const { col, type } of progressTypes) {
      await runner.query(`
        INSERT IGNORE INTO member_achievements (member_id, achievement_id, earned_at)
        SELECT counts.user_id, a.id, NOW()
        FROM (
          SELECT user_id, COUNT(*) AS cnt
          FROM member_points
          WHERE point_type = '${col}'
          GROUP BY user_id
        ) counts
        JOIN achievements a ON a.progress_type = '${type}' AND a.progress_target <= counts.cnt
      `);
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    const newKeys = [
      'legendary_maestro',
      'culinary_pioneer', 'master_explorer', 'legendary_scout',
      'social_butterfly', 'networker', 'ambassador', 'community_builder', 'legendary_connector',
      'first_review', 'food_connoisseur', 'dining_authority', 'master_critic', 'legendary_critic',
      'city_hopper_25', 'city_hopper_50', 'city_hopper_100',
      'secret_dinner_10', 'secret_dinner_25', 'secret_dinner_50', 'secret_dinner_100',
    ];
    await runner.query(
      `DELETE FROM achievements WHERE \`key\` IN (${newKeys.map(() => '?').join(',')})`,
      newKeys,
    );

    // Restore scout targets
    await runner.query(`UPDATE achievements SET progress_target = 3  WHERE \`key\` = 'scout'`);
    await runner.query(`UPDATE achievements SET progress_target = 8  WHERE \`key\` = 'culinary_explorer'`);
    await runner.query(`UPDATE achievements SET progress_target = 20 WHERE \`key\` = 'trailblazer'`);

    // Restore points to 0 for all progressive tiers
    await runner.query(`
      UPDATE achievements SET points = 0
      WHERE progress_type IN
        ('attendance','coordinator','new_restaurant_coordinator','invite','rating','city_hopper','secret_dinner')
    `);
    // Restore city hopper and secret dinner graduated points
    await runner.query(`UPDATE achievements SET points = 1 WHERE \`key\` = 'city_hopper_1'`);
    await runner.query(`UPDATE achievements SET points = 2 WHERE \`key\` = 'city_hopper_3'`);
    await runner.query(`UPDATE achievements SET points = 3 WHERE \`key\` = 'city_hopper_5'`);
    await runner.query(`UPDATE achievements SET points = 1 WHERE \`key\` = 'secret_dinner_1'`);
    await runner.query(`UPDATE achievements SET points = 2 WHERE \`key\` = 'secret_dinner_3'`);
    await runner.query(`UPDATE achievements SET points = 3 WHERE \`key\` = 'secret_dinner_5'`);

    // Remove achievement point records created by the new grant() logic
    await runner.query(`DELETE FROM member_points WHERE point_type = 'achievement'`);

    // Restore enum
    await runner.query(`
      ALTER TABLE member_points
        MODIFY COLUMN point_type
          ENUM('attendance','coordinator','coordinator_new_restaurant','invite','rating',
               'city_hopper','secret_dinner') NOT NULL
    `);
  }
}
