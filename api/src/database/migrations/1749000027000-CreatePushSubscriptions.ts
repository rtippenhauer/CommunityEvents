import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePushSubscriptions1749000027000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE push_subscriptions (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        endpoint TEXT NOT NULL,
        p256dh VARCHAR(512) NOT NULL,
        auth VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_endpoint (endpoint(500)),
        CONSTRAINT fk_push_sub_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE push_subscriptions`);
  }
}
