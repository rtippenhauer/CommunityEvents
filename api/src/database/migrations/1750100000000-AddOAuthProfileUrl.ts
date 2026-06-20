import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOAuthProfileUrl1750100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE oauth_accounts ADD COLUMN profile_url VARCHAR(512) NULL AFTER email`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE oauth_accounts DROP COLUMN profile_url`);
  }
}
