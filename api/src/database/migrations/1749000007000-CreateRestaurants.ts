import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRestaurants1749000007000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE restaurants (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name            VARCHAR(255) NOT NULL,
        address         VARCHAR(500) NOT NULL,
        lat             DECIMAL(10,7) NULL,
        lng             DECIMAL(10,7) NULL,
        phone           VARCHAR(30) NULL,
        website_url     VARCHAR(500) NULL,
        description     TEXT NULL,
        city_id         INT UNSIGNED NOT NULL,
        is_active       TINYINT(1) NOT NULL DEFAULT 1,
        imported_from   ENUM('manual','facebook_import') NOT NULL DEFAULT 'manual',
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_city (city_id),
        FULLTEXT INDEX ft_name (name),
        CONSTRAINT fk_restaurant_city FOREIGN KEY (city_id) REFERENCES cities(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(`
      CREATE TABLE restaurant_photos (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        restaurant_id   INT UNSIGNED NOT NULL,
        file_path       VARCHAR(500) NOT NULL,
        file_name       VARCHAR(255) NOT NULL,
        mime_type       VARCHAR(100) NOT NULL,
        sort_order      INT NOT NULL DEFAULT 0,
        uploaded_by     INT UNSIGNED NOT NULL,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_restaurant (restaurant_id),
        CONSTRAINT fk_photo_restaurant FOREIGN KEY (restaurant_id)
          REFERENCES restaurants(id) ON DELETE CASCADE,
        CONSTRAINT fk_photo_uploader FOREIGN KEY (uploaded_by) REFERENCES users(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS restaurant_photos`);
    await queryRunner.query(`DROP TABLE IF EXISTS restaurants`);
  }
}
