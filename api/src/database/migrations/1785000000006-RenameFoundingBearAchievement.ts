import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 32 follow-up: de-brand the "Founding Bear" achievement to the generic
// "Founding Member" for white-label forks. DinnerBears itself keeps the bear
// wording — detected from this instance's own APP_URL / BASE_DOMAIN, so the
// same image/migration set does the right thing on every instance.
export class RenameFoundingBearAchievement1785000000006 implements MigrationInterface {
  // DinnerBears keeps the bear. Detect it by domain (Rob's rule) OR by the
  // brand_name still being "DinnerBears" — the latter also covers a DinnerBears
  // stage instance running on an rtippenhauer.com subdomain, since every fork's
  // bootstrap changes brand_name away from "DinnerBears".
  private async isDinnerBears(queryRunner: QueryRunner): Promise<boolean> {
    const haystack = `${process.env.APP_URL ?? ''} ${process.env.BASE_DOMAIN ?? ''}`.toLowerCase();
    if (haystack.includes('dinnerbears.com')) return true;
    const rows = (await queryRunner.query(
      `SELECT config_value FROM app_config WHERE config_key = 'brand_name' LIMIT 1`,
    )) as Array<{ config_value: string }>;
    return (rows[0]?.config_value ?? '').trim().toLowerCase() === 'dinnerbears';
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.isDinnerBears(queryRunner)) return; // DinnerBears keeps "Founding Bear"

    await queryRunner.query(
      `UPDATE achievements SET name = 'Founding Member', title = 'Founding Member'
       WHERE \`key\` = 'founding_bear' AND name = 'Founding Bear'`,
    );
    // Keep any member who has the badge's title selected in sync so their
    // displayed title updates too.
    await queryRunner.query(
      `UPDATE users SET selected_title = 'Founding Member' WHERE selected_title = 'Founding Bear'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort revert for instances this migration actually renamed.
    await queryRunner.query(
      `UPDATE achievements SET name = 'Founding Bear', title = 'Founding Bear'
       WHERE \`key\` = 'founding_bear' AND name = 'Founding Member'`,
    );
    await queryRunner.query(
      `UPDATE users SET selected_title = 'Founding Bear' WHERE selected_title = 'Founding Member'`,
    );
  }
}
