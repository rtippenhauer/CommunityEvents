import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEvents1749000010000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE events (
        id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        city_id             INT UNSIGNED NOT NULL,
        restaurant_id       INT UNSIGNED NULL,
        restaurant_name     VARCHAR(255) NOT NULL,
        restaurant_address  VARCHAR(500) NOT NULL,
        restaurant_lat      DECIMAL(10,7) NULL,
        restaurant_lng      DECIMAL(10,7) NULL,
        title               VARCHAR(255) NOT NULL,
        description         TEXT NULL,
        additional_info     TEXT NULL,
        event_date          DATE NOT NULL,
        event_time          TIME NOT NULL,
        status              ENUM('draft','published','cancelled') NOT NULL DEFAULT 'draft',
        published_at        DATETIME NULL,
        cancelled_at        DATETIME NULL,
        cancelled_reason    TEXT NULL,
        facebook_share_text TEXT NULL,
        created_by          INT UNSIGNED NOT NULL,
        created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_city_date (city_id, event_date),
        INDEX idx_status (status),
        CONSTRAINT fk_event_city FOREIGN KEY (city_id) REFERENCES cities(id),
        CONSTRAINT fk_event_restaurant FOREIGN KEY (restaurant_id)
          REFERENCES restaurants(id) ON DELETE SET NULL,
        CONSTRAINT fk_event_created_by FOREIGN KEY (created_by) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS events`);
  }
}
