import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 31 (runtime white-label): the home-page "How it works" section was
// hardcoded, dinner-specific copy. It's now an admin-editable rich-text block
// (app_config key home_howitworks_html), edited in the same ngx-quill editor.
// Seed DinnerBears' existing wording so it's unchanged; a fresh fork's bootstrap
// clears it (empty = the section is hidden) until the fork writes its own.
export class SeedHomeHowItWorks1785000000003 implements MigrationInterface {
  // Uses the .steps/.step/.step-num grid markup (styled in home.component's
  // .how-copy) to reproduce the original three-column 01/02/03 layout. A fork
  // that edits this in the WYSIWYG editor gets a simpler prose list; the grid
  // markup is preserved as long as it's edited as raw HTML (e.g. via SQL).
  private readonly html =
    '<h2>Simple, social, delicious.</h2>' +
    '<div class="steps">' +
    '<div class="step"><div class="step-num">01</div><h3>Get Invited</h3>' +
    '<p>DinnerBears is invite-only. A current member sends you a link to join.</p></div>' +
    '<div class="step"><div class="step-num">02</div><h3>See the Week\'s Dinner</h3>' +
    "<p>Each week a new restaurant is chosen. Browse the details and who's coming.</p></div>" +
    '<div class="step"><div class="step-num">03</div><h3>RSVP &amp; Show Up</h3>' +
    '<p>Claim your spot, show up, and enjoy a great meal with great people.</p></div>' +
    '</div>';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.query(
      `SELECT config_key FROM app_config WHERE config_key = 'home_howitworks_html'`,
    );
    if ((existing as unknown[]).length > 0) return;
    await queryRunner.query(
      `INSERT INTO app_config (config_key, config_value, description)
       VALUES ('home_howitworks_html', ?, 'Home-page "How it works" block (rich text; empty = hidden)')`,
      [this.html],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM app_config WHERE config_key = 'home_howitworks_html'`);
  }
}
