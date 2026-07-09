import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateMerchConfig1751500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE merch_config (
        id                         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        store_url                  VARCHAR(500) NOT NULL,
        founding_bear_product_url  VARCHAR(500) NULL,
        updated_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await queryRunner.query(
      `INSERT INTO merch_config (store_url, founding_bear_product_url) VALUES (?, NULL)`,
      ['https://dinnerbears.printful.me/'],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS merch_config`);
  }
}
