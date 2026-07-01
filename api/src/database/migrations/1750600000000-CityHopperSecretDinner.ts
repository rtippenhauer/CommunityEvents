import { MigrationInterface, QueryRunner } from 'typeorm';

export class CityHopperSecretDinner1750600000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // from_other_city flag on RSVPs
    await runner.query(`
      ALTER TABLE event_rsvps
        ADD COLUMN from_other_city TINYINT(1) NOT NULL DEFAULT 0
    `);

    // is_secret flag on events
    await runner.query(`
      ALTER TABLE events
        ADD COLUMN is_secret TINYINT(1) NOT NULL DEFAULT 0
    `);

    // Extend progress_type enum
    await runner.query(`
      ALTER TABLE achievements
        MODIFY COLUMN progress_type
          ENUM('attendance','coordinator','new_restaurant_coordinator','invite','rating',
               'founding','event','city_hopper','secret_dinner') NULL
    `);

    // Extend point_type enum
    await runner.query(`
      ALTER TABLE member_points
        MODIFY COLUMN point_type
          ENUM('attendance','coordinator','coordinator_new_restaurant','invite','rating',
               'city_hopper','secret_dinner') NOT NULL
    `);

    // Seed City Hopper tiers
    await runner.query(`
      INSERT INTO achievements (\`key\`, name, description, icon, progress_type, progress_target, points, title, is_secret)
      VALUES
        ('city_hopper_1',  'City Hopper',    'Attended a DinnerBears dinner in another city.',                  'flight',               'city_hopper', 1,  1, NULL,             0),
        ('city_hopper_3',  'Road Tripper',   'Attended dinners in 3 different cities.',                         'directions_car',       'city_hopper', 3,  2, 'Road Tripper',   0),
        ('city_hopper_5',  'Frequent Flyer', 'Attended DinnerBears dinners in 5 cities.',                       'connecting_airports',  'city_hopper', 5,  3, 'Frequent Flyer', 0),
        ('city_hopper_10', 'Globe Trotter',  'Attended DinnerBears dinners in 10 cities.',                      'public',               'city_hopper', 10, 5, 'Globe Trotter',  0)
    `);

    // Seed Secret Dinner tiers
    await runner.query(`
      INSERT INTO achievements (\`key\`, name, description, icon, progress_type, progress_target, points, title, is_secret)
      VALUES
        ('secret_dinner_1', 'Mystery Diner',  'Attended a DinnerBears secret dinner.',              'lock',           'secret_dinner', 1, 1, NULL,             0),
        ('secret_dinner_3', 'Secret Society', 'Attended 3 DinnerBears secret dinners.',             'visibility_off', 'secret_dinner', 3, 2, 'Secret Society', 0),
        ('secret_dinner_5', 'Shadow Bear',    'Attended 5 DinnerBears secret dinners.',             'dark_mode',      'secret_dinner', 5, 3, 'Shadow Bear',    0)
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DELETE FROM achievements WHERE \`key\` IN ('city_hopper_1','city_hopper_3','city_hopper_5','city_hopper_10','secret_dinner_1','secret_dinner_3','secret_dinner_5')`);
    await runner.query(`ALTER TABLE member_points MODIFY COLUMN point_type ENUM('attendance','coordinator','coordinator_new_restaurant','invite','rating') NOT NULL`);
    await runner.query(`ALTER TABLE achievements MODIFY COLUMN progress_type ENUM('attendance','coordinator','new_restaurant_coordinator','invite','rating','founding','event') NULL`);
    await runner.query(`ALTER TABLE events DROP COLUMN is_secret`);
    await runner.query(`ALTER TABLE event_rsvps DROP COLUMN from_other_city`);
  }
}
