import { MigrationInterface, QueryRunner } from 'typeorm';

export class SeedAchievements1750500001000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      INSERT INTO achievements (\`key\`, name, description, icon, title, is_secret) VALUES
        ('founding_bear',         'Founding Bear',    'Joined DinnerBears before the community points system launched.',                                         'pets',           'Founding Bear',  0),
        ('first_dinner',          'First Dinner',     'Attended your very first DinnerBears dinner.',                                                            'restaurant',     NULL,             0),
        ('regular',               'Regular',          'Attended 5 DinnerBears dinners.',                                                                         'local_dining',   'Regular',        0),
        ('veteran',               'Veteran',          'Attended 25 DinnerBears dinners.',                                                                        'military_tech',  'Veteran',        0),
        ('first_coordinator',     'Coordinator',      'Coordinated your first DinnerBears dinner reservation.',                                                  'phone_in_talk',  NULL,             0),
        ('scout',                 'Scout',            'Coordinated dinners at 3 different restaurants that had never hosted a DinnerBears event before.',        'explore',        'Scout',          0),
        ('connector',             'Connector',        'Successfully invited someone who attended their first dinner.',                                           'group_add',      NULL,             0),
        ('critic',                'Critic',           'Submitted 5 restaurant ratings.',                                                                         'rate_review',    NULL,             0)
    `);

    // Backfill Founding Bear for all currently active members
    await runner.query(`
      INSERT INTO member_achievements (member_id, achievement_id, earned_at)
      SELECT u.id, a.id, NOW()
      FROM users u
      JOIN achievements a ON a.\`key\` = 'founding_bear'
      WHERE u.status = 'active'
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DELETE FROM member_achievements WHERE achievement_id IN (SELECT id FROM achievements WHERE \`key\` = 'founding_bear')`);
    await runner.query(`DELETE FROM achievements`);
  }
}
