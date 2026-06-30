import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase15AchievementTiers1750500003000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Give first_coordinator a title (it was previously NULL)
    await runner.query(`
      UPDATE achievements SET title = 'Table Setter'
      WHERE \`key\` = 'first_coordinator' AND title IS NULL
    `);

    // New attendance tiers
    await runner.query(`
      INSERT IGNORE INTO achievements
        (\`key\`, name, description, icon, progress_type, progress_target, title, is_secret, points)
      VALUES
        ('table_familiar', 'Familiar Face',
         'Attended 10 DinnerBears dinners. The hosts know your order.',
         'face', 'attendance', 10, 'Familiar Face', 0, 0),

        ('devoted_diner', 'Devoted Diner',
         'Attended 50 DinnerBears dinners. Dinner is basically your religion at this point.',
         'favorite', 'attendance', 50, 'Devoted Diner', 0, 0),

        ('legend_of_the_table', 'Legend of the Table',
         'Attended 100 DinnerBears dinners. You are the dinner. The dinner is you.',
         'auto_awesome', 'attendance', 100, 'Legend', 0, 0)
    `);

    // New coordinator tiers
    await runner.query(`
      INSERT IGNORE INTO achievements
        (\`key\`, name, description, icon, progress_type, progress_target, title, is_secret, points)
      VALUES
        ('gracious_host', 'Gracious Host',
         'Coordinated reservations for 5 events. You set a fine table.',
         'room_service', 'coordinator', 5, 'Gracious Host', 0, 0),

        ('maitre_d', 'Maître D\\'',
         'Coordinated reservations for 10 events. The restaurant expects your call.',
         'local_dining', 'coordinator', 10, 'Maître D\\'', 0, 0),

        ('banquet_captain', 'Banquet Captain',
         'Coordinated reservations for 25 events. You run the room.',
         'military_tech', 'coordinator', 25, 'Banquet Captain', 0, 0),

        ('grand_maestro', 'Grand Maestro',
         'Coordinated reservations for 50 events. The bears dine because of you.',
         'stars', 'coordinator', 50, 'Grand Maestro', 0, 0)
    `);

    // New scout/explorer tiers
    await runner.query(`
      INSERT IGNORE INTO achievements
        (\`key\`, name, description, icon, progress_type, progress_target, title, is_secret, points)
      VALUES
        ('culinary_explorer', 'Culinary Explorer',
         'Coordinated at 8 restaurants new to DinnerBears. The map keeps expanding.',
         'explore', 'new_restaurant_coordinator', 8, 'Culinary Explorer', 0, 0),

        ('trailblazer', 'Trailblazer',
         'Coordinated at 20 restaurants new to DinnerBears. You are the reason we have favorites.',
         'hiking', 'new_restaurant_coordinator', 20, 'Trailblazer', 0, 0)
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    const keys = [
      'table_familiar', 'devoted_diner', 'legend_of_the_table',
      'gracious_host', 'maitre_d', 'banquet_captain', 'grand_maestro',
      'culinary_explorer', 'trailblazer',
    ];
    await runner.query(
      `DELETE FROM achievements WHERE \`key\` IN (${keys.map(() => '?').join(',')})`,
      keys,
    );
    await runner.query(`
      UPDATE achievements SET title = NULL WHERE \`key\` = 'first_coordinator'
    `);
  }
}
