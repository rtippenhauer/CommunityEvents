import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase15Points1750500000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // achievements definition table
    await runner.query(`
      CREATE TABLE achievements (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`key\`     VARCHAR(64)  NOT NULL,
        name        VARCHAR(120) NOT NULL,
        description VARCHAR(500) NOT NULL,
        icon        VARCHAR(80)  NOT NULL DEFAULT 'emoji_events',
        title       VARCHAR(100) NULL DEFAULT NULL,
        is_secret   TINYINT(1)   NOT NULL DEFAULT 0,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_achievements_key (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // member → achievement join (earned records)
    await runner.query(`
      CREATE TABLE member_achievements (
        id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
        member_id      INT UNSIGNED NOT NULL,
        achievement_id INT UNSIGNED NOT NULL,
        earned_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_member_achievement (member_id, achievement_id),
        CONSTRAINT fk_ma_member      FOREIGN KEY (member_id)      REFERENCES users        (id) ON DELETE CASCADE,
        CONSTRAINT fk_ma_achievement FOREIGN KEY (achievement_id) REFERENCES achievements (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // bear points ledger
    await runner.query(`
      CREATE TABLE member_points (
        id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id      INT UNSIGNED NOT NULL,
        point_type   ENUM('attendance','coordinator','coordinator_new_restaurant','invite','rating') NOT NULL,
        reference_id INT UNSIGNED NULL DEFAULT NULL,
        points       TINYINT      NOT NULL DEFAULT 1,
        awarded_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_mp_user (user_id),
        CONSTRAINT fk_mp_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // selected title on users
    await runner.query(`
      ALTER TABLE users
        ADD COLUMN selected_title VARCHAR(100) NULL DEFAULT NULL AFTER calendar_rsvp_only
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE users DROP COLUMN selected_title`);
    await runner.query(`DROP TABLE member_points`);
    await runner.query(`DROP TABLE member_achievements`);
    await runner.query(`DROP TABLE achievements`);
  }
}
