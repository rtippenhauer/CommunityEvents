import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase6FeedbackAlter1749000023000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // MySQL doesn't support ADD COLUMN IF NOT EXISTS — check information_schema instead
    const existing: { COLUMN_NAME: string }[] = await queryRunner.query(`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback'
        AND COLUMN_NAME IN ('title', 'is_private', 'upvote_count')
    `);
    const cols = new Set(existing.map((r) => r.COLUMN_NAME));

    if (!cols.has('title')) {
      await queryRunner.query(`ALTER TABLE feedback ADD COLUMN title VARCHAR(200) NULL AFTER user_id`);
    }
    if (!cols.has('is_private')) {
      await queryRunner.query(`ALTER TABLE feedback ADD COLUMN is_private TINYINT(1) NOT NULL DEFAULT 0 AFTER admin_note`);
    }
    if (!cols.has('upvote_count')) {
      await queryRunner.query(`ALTER TABLE feedback ADD COLUMN upvote_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER is_private`);
    }

    // Widen enum to include BOTH old and new values so the UPDATE below is valid
    await queryRunner.query(`
      ALTER TABLE feedback
        MODIFY COLUMN status ENUM('new','under_review','in_progress','released','wont_do','duplicate','open','resolved','shipped','closed','wont_fix')
          NOT NULL DEFAULT 'new'
    `);

    // Remap old values to new
    await queryRunner.query(`UPDATE feedback SET status = 'open'     WHERE status IN ('new', 'under_review')`);
    await queryRunner.query(`UPDATE feedback SET status = 'shipped'  WHERE status = 'released'`);
    await queryRunner.query(`UPDATE feedback SET status = 'wont_fix' WHERE status = 'wont_do'`);
    await queryRunner.query(`UPDATE feedback SET status = 'closed'   WHERE status = 'duplicate'`);

    // Narrow enum to only new values
    await queryRunner.query(`
      ALTER TABLE feedback
        MODIFY COLUMN status ENUM('open','in_progress','resolved','shipped','closed','wont_fix')
          NOT NULL DEFAULT 'open'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Widen enum first so old values are valid targets for the UPDATE
    await queryRunner.query(`
      ALTER TABLE feedback
        MODIFY COLUMN status ENUM('new','under_review','in_progress','released','wont_do','duplicate','open','resolved','shipped','closed','wont_fix')
          NOT NULL DEFAULT 'open'
    `);

    // Restore old enum values (best-effort — resolved has no equivalent, maps back to new)
    await queryRunner.query(`UPDATE feedback SET status = 'new'       WHERE status IN ('open', 'resolved')`);
    await queryRunner.query(`UPDATE feedback SET status = 'released'  WHERE status = 'shipped'`);
    await queryRunner.query(`UPDATE feedback SET status = 'wont_do'   WHERE status = 'wont_fix'`);
    await queryRunner.query(`UPDATE feedback SET status = 'duplicate' WHERE status = 'closed'`);

    await queryRunner.query(`
      ALTER TABLE feedback
        MODIFY COLUMN status ENUM('new','under_review','in_progress','released','wont_do','duplicate')
          NOT NULL DEFAULT 'new'
    `);

    await queryRunner.query(`
      ALTER TABLE feedback
        DROP COLUMN upvote_count,
        DROP COLUMN is_private,
        DROP COLUMN title
    `);
  }
}
