import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 31 (runtime white-label): preset avatars move from a static
// public/avatars/manifest.json (baked into the image, bear-only) to a
// per-instance, admin-managed `avatar` table served via /api/v1/avatars/manifest.
// This seeds the existing 32 bear avatars so DinnerBears is unchanged (the
// image still ships the static /avatars/bear-*.{jpg,png} files these rows
// point at). A fresh fork's bootstrap clears these defaults so it can upload
// its own set (a non-bear group shouldn't inherit bears).
export class CreateAvatarsTable1785000000000 implements MigrationInterface {
  // Mirrors public/avatars/manifest.json at the time of this migration.
  private readonly bears: Array<[string, string]> = [
    ['/avatars/bear-BBQ.png', 'BBQ'],
    ['/avatars/bear-DJ.png', 'DJ'],
    ['/avatars/bear-NASCAR.png', 'NASCAR'],
    ['/avatars/bear-artist.jpg', 'Artist'],
    ['/avatars/bear-astronaut.jpg', 'Astronaut'],
    ['/avatars/bear-athlete.jpg', 'Athlete'],
    ['/avatars/bear-bookworm.jpg', 'Bookworm'],
    ['/avatars/bear-brewmaster.png', 'Brewmaster'],
    ['/avatars/bear-camper.png', 'Camper'],
    ['/avatars/bear-captain.png', 'Captain'],
    ['/avatars/bear-chef.jpg', 'Chef'],
    ['/avatars/bear-cool.jpg', 'Cool'],
    ['/avatars/bear-dapper.jpg', 'Dapper'],
    ['/avatars/bear-default.jpg', 'Default'],
    ['/avatars/bear-disco.jpg', 'Disco'],
    ['/avatars/bear-explorer.jpg', 'Explorer'],
    ['/avatars/bear-flannel.jpg', 'Flannel'],
    ['/avatars/bear-hawaiian.png', 'Hawaiian'],
    ['/avatars/bear-hoodie.jpg', 'Hoodie'],
    ['/avatars/bear-karaoke.jpg', 'Karaoke'],
    ['/avatars/bear-mandalorian.png', 'Mandalorian'],
    ['/avatars/bear-musician.jpg', 'Musician'],
    ['/avatars/bear-nerdy.png', 'Nerdy'],
    ['/avatars/bear-pirate.jpg', 'Pirate'],
    ['/avatars/bear-rainbow.jpg', 'Rainbow'],
    ['/avatars/bear-shopping.png', 'Shopping'],
    ['/avatars/bear-steampunk.jpg', 'Steampunk'],
    ['/avatars/bear-superhero.png', 'Superhero'],
    ['/avatars/bear-trivia.png', 'Trivia'],
    ['/avatars/bear-ultraman.png', 'Ultraman'],
    ['/avatars/bear-viking.png', 'Viking'],
    ['/avatars/bear-wizard.png', 'Wizard'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS avatar (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        path VARCHAR(500) NOT NULL,
        label VARCHAR(100) NOT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY uq_avatar_path (path)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Seed only if empty, so re-running (or a partially-applied state) never
    // duplicates rows. Alphabetical sort_order matches the old manifest order.
    const [{ n }] = (await queryRunner.query(`SELECT COUNT(*) AS n FROM avatar`)) as [{ n: number }];
    if (Number(n) > 0) return;

    let i = 0;
    for (const [path, label] of this.bears) {
      await queryRunner.query(
        `INSERT INTO avatar (path, label, sort_order) VALUES (?, ?, ?)`,
        [path, label, i++],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS avatar`);
  }
}
