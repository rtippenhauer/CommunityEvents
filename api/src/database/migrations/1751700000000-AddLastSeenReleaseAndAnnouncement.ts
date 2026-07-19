import { MigrationInterface, QueryRunner } from 'typeorm';

// Backs the post-login "what's new" splash (releases + announcements side of
// it — achievements already have their own seen-tracking via
// member_achievements.seen_at). Rather than a per-item read-tracking table,
// each user just carries a pointer to the latest release/announcement they've
// been shown, since the splash only ever surfaces the single latest of each.
//
// Backfilled to today's current latest of each so existing members' pointers
// already match what's out there — only a release/announcement published
// after this migration runs will ever differ and trigger the splash. Without
// this backfill every existing member would see whatever's currently latest
// on their very next login, which is exactly the "flood of history" this is
// meant to avoid.
export class AddLastSeenReleaseAndAnnouncement1751700000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE users
        ADD COLUMN last_seen_release_id INT UNSIGNED NULL,
        ADD COLUMN last_seen_announcement_id INT UNSIGNED NULL,
        ADD CONSTRAINT fk_users_last_seen_release FOREIGN KEY (last_seen_release_id) REFERENCES releases(id) ON DELETE SET NULL,
        ADD CONSTRAINT fk_users_last_seen_announcement FOREIGN KEY (last_seen_announcement_id) REFERENCES announcements(id) ON DELETE SET NULL
    `);

    const [latestRelease] = await runner.query(
      `SELECT id FROM releases WHERE published_at IS NOT NULL ORDER BY published_at DESC LIMIT 1`,
    );
    if (latestRelease) {
      await runner.query(`UPDATE users SET last_seen_release_id = ?`, [latestRelease.id]);
    }

    const [latestAnnouncement] = await runner.query(
      `SELECT id FROM announcements WHERE status = 'published' ORDER BY published_at DESC LIMIT 1`,
    );
    if (latestAnnouncement) {
      await runner.query(`UPDATE users SET last_seen_announcement_id = ?`, [latestAnnouncement.id]);
    }
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE users
        DROP FOREIGN KEY fk_users_last_seen_release,
        DROP FOREIGN KEY fk_users_last_seen_announcement,
        DROP COLUMN last_seen_release_id,
        DROP COLUMN last_seen_announcement_id
    `);
  }
}
