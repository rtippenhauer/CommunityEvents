import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase9RestaurantRatings1749200001000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE restaurant_ratings (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        member_id INT UNSIGNED NOT NULL,
        event_id INT UNSIGNED NOT NULL,
        restaurant_id INT UNSIGNED NOT NULL,
        food TINYINT UNSIGNED NOT NULL,
        service TINYINT UNSIGNED NOT NULL,
        value_rating TINYINT UNSIGNED NOT NULL,
        noise TINYINT UNSIGNED NOT NULL,
        comment TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_member_event (member_id, event_id),
        CONSTRAINT fk_rating_member FOREIGN KEY (member_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_rating_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        CONSTRAINT fk_rating_restaurant FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE restaurant_ratings`);
  }
}
