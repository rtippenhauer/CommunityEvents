import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 31 (runtime white-label): the home-page "Our Story" image was a
// hardcoded /images/story-map.png. It's now an admin-uploadable branding image
// (app_config key brand_story_url; empty = hidden). Seed DinnerBears' existing
// map so it's unchanged — the static file still ships in the image. A fresh
// fork's bootstrap clears this so a new instance shows just the story copy
// until it uploads its own Story Brand Image.
export class SeedStoryBrandImage1785000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.query(
      `SELECT config_key FROM app_config WHERE config_key = 'brand_story_url'`,
    );
    if ((existing as unknown[]).length > 0) return;
    await queryRunner.query(
      `INSERT INTO app_config (config_key, config_value, description)
       VALUES ('brand_story_url', '/images/story-map.png',
               'Home-page Our Story image (empty = hidden)')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM app_config WHERE config_key = 'brand_story_url'`);
  }
}
