import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 31 (runtime white-label): the home-page hero copy (the text beside the
// upcoming-events panel) was hardcoded DinnerBears framing ("weekly dinners",
// "restaurants"). It's now an admin-editable rich-text block (app_config key
// home_hero_html), edited in the same ngx-quill editor as the legal/story copy.
// Seed DinnerBears' existing wording so it's unchanged; a fresh fork's bootstrap
// clears it, and the frontend then shows a generic branded hero until the fork
// writes its own.
export class SeedHomeHeroCopy1785000000002 implements MigrationInterface {
  // <em> inside the headline renders in the accent color (see home.component's
  // .hero-copy styles), reproducing the original two-tone "Every week." accent.
  private readonly html =
    '<h2>Good food.<br>Good people.<br><em>Every week.</em></h2>' +
    '<p>DinnerBears is an invite-only community for people who love discovering ' +
    'great restaurants together. Weekly dinners, real connections.</p>';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.query(
      `SELECT config_key FROM app_config WHERE config_key = 'home_hero_html'`,
    );
    if ((existing as unknown[]).length > 0) return;
    await queryRunner.query(
      `INSERT INTO app_config (config_key, config_value, description)
       VALUES ('home_hero_html', ?, 'Home-page hero copy (rich text; empty = generic default)')`,
      [this.html],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM app_config WHERE config_key = 'home_hero_html'`);
  }
}
