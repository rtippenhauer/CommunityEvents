import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeMerchStoreUrlNullable1751600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE merch_config
      MODIFY COLUMN store_url VARCHAR(500) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE merch_config SET store_url = 'https://dinnerbears.printful.me/' WHERE store_url IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE merch_config
      MODIFY COLUMN store_url VARCHAR(500) NOT NULL
    `);
  }
}
