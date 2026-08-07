import { MigrationInterface, QueryRunner } from 'typeorm';

// Comment editing: members can edit their own comments (and event comment
// replies) with no time limit. edited_at stays NULL until the first edit,
// which is what drives the "(edited)" marker in the UI — a non-null value
// means the body no longer matches what was originally posted.
const TARGETS: { table: string; after: string }[] = [
  { table: 'event_comments', after: 'body' },
  { table: 'event_comment_replies', after: 'body' },
  { table: 'announcement_comments', after: 'body' },
];

export class AddEditedAtToComments1785000000011 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, after } of TARGETS) {
      const existing = await queryRunner.query(
        `SELECT COUNT(*) AS n FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = '${table}' AND column_name = 'edited_at'`,
      );
      if (Number(existing[0]?.n ?? 0) > 0) continue; // already added

      await queryRunner.query(
        `ALTER TABLE ${table} ADD COLUMN edited_at DATETIME NULL AFTER ${after}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table } of TARGETS) {
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN edited_at`);
    }
  }
}
