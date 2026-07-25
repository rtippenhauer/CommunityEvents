import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 29 (white-label template): the "restaurant" concept generalizes to
// "location" so a fork like Sons (member houses, not restaurants) fits the
// same schema. The app's own UI copy keeps saying "Restaurant" — this is a
// code/schema-only rename, not a product change for DinnerBears itself.
//
// Enum values are also renamed and normalized here:
//   content_reports.content_type: restaurant_rating   -> location_rating
//   member_points.point_type:     coordinator_new_restaurant -> new_location_coordinator
//   achievements.progress_type:   new_restaurant_coordinator -> new_location_coordinator
// (the last two used inconsistent word order before; both now match.)
export class RenameRestaurantsToLocations1784808329000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── 1. Table renames (atomic; FKs on/into these tables follow automatically) ──
    await queryRunner.query(`
      RENAME TABLE
        restaurants TO locations,
        restaurant_photos TO location_photos,
        restaurant_ratings TO location_ratings
    `);

    // ── 2. locations: rename FK constraints to match (columns unaffected) ──
    await this.renameForeignKey(queryRunner, 'locations', 'fk_restaurant_city', 'fk_location_city', `
      ALTER TABLE locations ADD CONSTRAINT fk_location_city FOREIGN KEY (city_id) REFERENCES cities(id)
    `);
    await this.renameForeignKey(queryRunner, 'locations', 'fk_restaurant_created_by', 'fk_location_created_by', `
      ALTER TABLE locations ADD CONSTRAINT fk_location_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    `);
    await this.renameForeignKey(queryRunner, 'locations', 'fk_restaurant_updated_by', 'fk_location_updated_by', `
      ALTER TABLE locations ADD CONSTRAINT fk_location_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    `);

    // ── 3. location_photos: rename column, index, FK ──
    await this.dropForeignKeyIfExists(queryRunner, 'location_photos', 'fk_photo_restaurant');
    if (await this.columnExists(queryRunner, 'location_photos', 'restaurant_id')) {
      await queryRunner.query(`
        ALTER TABLE location_photos CHANGE COLUMN restaurant_id location_id INT UNSIGNED NOT NULL
      `);
    }
    if (await this.indexExists(queryRunner, 'location_photos', 'idx_restaurant')) {
      await queryRunner.query(`ALTER TABLE location_photos RENAME INDEX idx_restaurant TO idx_location`);
    }
    await this.dropIndexIfExists(queryRunner, 'location_photos', 'fk_photo_restaurant');
    if (!(await this.foreignKeyExists(queryRunner, 'location_photos', 'fk_photo_location'))) {
      await queryRunner.query(`
        ALTER TABLE location_photos
          ADD CONSTRAINT fk_photo_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
      `);
    }

    // ── 4. location_ratings: rename column, FK ──
    await this.dropForeignKeyIfExists(queryRunner, 'location_ratings', 'fk_rating_restaurant');
    if (await this.columnExists(queryRunner, 'location_ratings', 'restaurant_id')) {
      await queryRunner.query(`
        ALTER TABLE location_ratings CHANGE COLUMN restaurant_id location_id INT UNSIGNED NOT NULL
      `);
    }
    await this.dropIndexIfExists(queryRunner, 'location_ratings', 'fk_rating_restaurant');
    if (!(await this.foreignKeyExists(queryRunner, 'location_ratings', 'fk_rating_location'))) {
      await queryRunner.query(`
        ALTER TABLE location_ratings
          ADD CONSTRAINT fk_rating_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE
      `);
    }

    // ── 5. events: rename snapshot columns + FK ──
    await this.dropForeignKeyIfExists(queryRunner, 'events', 'fk_event_restaurant');
    if (await this.columnExists(queryRunner, 'events', 'restaurant_id')) {
      await queryRunner.query(`
        ALTER TABLE events
          CHANGE COLUMN restaurant_id location_id INT UNSIGNED NULL,
          CHANGE COLUMN restaurant_name location_name VARCHAR(255) NOT NULL,
          CHANGE COLUMN restaurant_address location_address VARCHAR(500) NOT NULL,
          CHANGE COLUMN restaurant_lat location_lat DECIMAL(10,7) NULL,
          CHANGE COLUMN restaurant_lng location_lng DECIMAL(10,7) NULL
      `);
    }
    await this.dropIndexIfExists(queryRunner, 'events', 'fk_event_restaurant');
    if (!(await this.foreignKeyExists(queryRunner, 'events', 'fk_event_location'))) {
      await queryRunner.query(`
        ALTER TABLE events
          ADD CONSTRAINT fk_event_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL
      `);
    }

    // ── 6. Enum renames — widen, backfill, narrow (avoids a window where
    //      existing rows hold a value the column no longer permits) ──
    await queryRunner.query(`
      ALTER TABLE content_reports
        MODIFY COLUMN content_type
          ENUM('event_comment','event_comment_reply','announcement_comment','restaurant_rating','location_rating') NOT NULL
    `);
    await queryRunner.query(`UPDATE content_reports SET content_type = 'location_rating' WHERE content_type = 'restaurant_rating'`);
    await queryRunner.query(`
      ALTER TABLE content_reports
        MODIFY COLUMN content_type
          ENUM('event_comment','event_comment_reply','announcement_comment','location_rating') NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE member_points
        MODIFY COLUMN point_type
          ENUM('attendance','coordinator','coordinator_new_restaurant','invite','rating',
               'city_hopper','secret_dinner','achievement','new_location_coordinator') NOT NULL
    `);
    await queryRunner.query(`UPDATE member_points SET point_type = 'new_location_coordinator' WHERE point_type = 'coordinator_new_restaurant'`);
    await queryRunner.query(`
      ALTER TABLE member_points
        MODIFY COLUMN point_type
          ENUM('attendance','coordinator','invite','rating',
               'city_hopper','secret_dinner','achievement','new_location_coordinator') NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE achievements
        MODIFY COLUMN progress_type
          ENUM('attendance','coordinator','new_restaurant_coordinator','invite','rating',
               'founding','event','city_hopper','secret_dinner','login','new_location_coordinator') NULL
    `);
    await queryRunner.query(`UPDATE achievements SET progress_type = 'new_location_coordinator' WHERE progress_type = 'new_restaurant_coordinator'`);
    await queryRunner.query(`
      ALTER TABLE achievements
        MODIFY COLUMN progress_type
          ENUM('attendance','coordinator','invite','rating',
               'founding','event','city_hopper','secret_dinner','login','new_location_coordinator') NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ── Enum renames, reversed ──
    await queryRunner.query(`
      ALTER TABLE achievements
        MODIFY COLUMN progress_type
          ENUM('attendance','coordinator','new_restaurant_coordinator','invite','rating',
               'founding','event','city_hopper','secret_dinner','login','new_location_coordinator') NULL
    `);
    await queryRunner.query(`UPDATE achievements SET progress_type = 'new_restaurant_coordinator' WHERE progress_type = 'new_location_coordinator'`);
    await queryRunner.query(`
      ALTER TABLE achievements
        MODIFY COLUMN progress_type
          ENUM('attendance','coordinator','new_restaurant_coordinator','invite','rating',
               'founding','event','city_hopper','secret_dinner','login') NULL
    `);

    await queryRunner.query(`
      ALTER TABLE member_points
        MODIFY COLUMN point_type
          ENUM('attendance','coordinator','coordinator_new_restaurant','invite','rating',
               'city_hopper','secret_dinner','achievement','new_location_coordinator') NOT NULL
    `);
    await queryRunner.query(`UPDATE member_points SET point_type = 'coordinator_new_restaurant' WHERE point_type = 'new_location_coordinator'`);
    await queryRunner.query(`
      ALTER TABLE member_points
        MODIFY COLUMN point_type
          ENUM('attendance','coordinator','coordinator_new_restaurant','invite','rating',
               'city_hopper','secret_dinner','achievement') NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE content_reports
        MODIFY COLUMN content_type
          ENUM('event_comment','event_comment_reply','announcement_comment','restaurant_rating','location_rating') NOT NULL
    `);
    await queryRunner.query(`UPDATE content_reports SET content_type = 'restaurant_rating' WHERE content_type = 'location_rating'`);
    await queryRunner.query(`
      ALTER TABLE content_reports
        MODIFY COLUMN content_type
          ENUM('event_comment','event_comment_reply','announcement_comment','restaurant_rating') NOT NULL
    `);

    // ── events ──
    await this.dropForeignKeyIfExists(queryRunner, 'events', 'fk_event_location');
    if (await this.columnExists(queryRunner, 'events', 'location_id')) {
      await queryRunner.query(`
        ALTER TABLE events
          CHANGE COLUMN location_id restaurant_id INT UNSIGNED NULL,
          CHANGE COLUMN location_name restaurant_name VARCHAR(255) NOT NULL,
          CHANGE COLUMN location_address restaurant_address VARCHAR(500) NOT NULL,
          CHANGE COLUMN location_lat restaurant_lat DECIMAL(10,7) NULL,
          CHANGE COLUMN location_lng restaurant_lng DECIMAL(10,7) NULL
      `);
    }
    await this.dropIndexIfExists(queryRunner, 'events', 'fk_event_location');
    if (!(await this.foreignKeyExists(queryRunner, 'events', 'fk_event_restaurant'))) {
      await queryRunner.query(`
        ALTER TABLE events
          ADD CONSTRAINT fk_event_restaurant FOREIGN KEY (restaurant_id) REFERENCES locations(id) ON DELETE SET NULL
      `);
    }

    // ── location_ratings ──
    await this.dropForeignKeyIfExists(queryRunner, 'location_ratings', 'fk_rating_location');
    if (await this.columnExists(queryRunner, 'location_ratings', 'location_id')) {
      await queryRunner.query(`
        ALTER TABLE location_ratings CHANGE COLUMN location_id restaurant_id INT UNSIGNED NOT NULL
      `);
    }
    await this.dropIndexIfExists(queryRunner, 'location_ratings', 'fk_rating_location');
    if (!(await this.foreignKeyExists(queryRunner, 'location_ratings', 'fk_rating_restaurant'))) {
      await queryRunner.query(`
        ALTER TABLE location_ratings
          ADD CONSTRAINT fk_rating_restaurant FOREIGN KEY (restaurant_id) REFERENCES locations(id) ON DELETE CASCADE
      `);
    }

    // ── location_photos ──
    await this.dropForeignKeyIfExists(queryRunner, 'location_photos', 'fk_photo_location');
    if (await this.columnExists(queryRunner, 'location_photos', 'location_id')) {
      await queryRunner.query(`
        ALTER TABLE location_photos CHANGE COLUMN location_id restaurant_id INT UNSIGNED NOT NULL
      `);
    }
    if (await this.indexExists(queryRunner, 'location_photos', 'idx_location')) {
      await queryRunner.query(`ALTER TABLE location_photos RENAME INDEX idx_location TO idx_restaurant`);
    }
    await this.dropIndexIfExists(queryRunner, 'location_photos', 'fk_photo_location');
    if (!(await this.foreignKeyExists(queryRunner, 'location_photos', 'fk_photo_restaurant'))) {
      await queryRunner.query(`
        ALTER TABLE location_photos
          ADD CONSTRAINT fk_photo_restaurant FOREIGN KEY (restaurant_id) REFERENCES locations(id) ON DELETE CASCADE
      `);
    }

    // ── locations FKs ──
    await this.renameForeignKey(queryRunner, 'locations', 'fk_location_city', 'fk_restaurant_city', `
      ALTER TABLE locations ADD CONSTRAINT fk_restaurant_city FOREIGN KEY (city_id) REFERENCES cities(id)
    `);
    await this.renameForeignKey(queryRunner, 'locations', 'fk_location_created_by', 'fk_restaurant_created_by', `
      ALTER TABLE locations ADD CONSTRAINT fk_restaurant_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    `);
    await this.renameForeignKey(queryRunner, 'locations', 'fk_location_updated_by', 'fk_restaurant_updated_by', `
      ALTER TABLE locations ADD CONSTRAINT fk_restaurant_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
    `);

    // ── Table renames, reversed ──
    await queryRunner.query(`
      RENAME TABLE
        locations TO restaurants,
        location_photos TO restaurant_photos,
        location_ratings TO restaurant_ratings
    `);
  }

  // ── information_schema helpers, same idiom as AddRestaurantAuditFields ──

  private async columnExists(runner: QueryRunner, table: string, column: string): Promise<boolean> {
    const rows = await runner.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return rows.length > 0;
  }

  private async indexExists(runner: QueryRunner, table: string, indexName: string): Promise<boolean> {
    const rows = await runner.query(
      `SELECT 1 FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
      [table, indexName],
    );
    return rows.length > 0;
  }

  private async foreignKeyExists(runner: QueryRunner, table: string, fkName: string): Promise<boolean> {
    const rows = await runner.query(
      `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
      [table, fkName],
    );
    return rows.length > 0;
  }

  private async dropForeignKeyIfExists(runner: QueryRunner, table: string, fkName: string): Promise<void> {
    if (await this.foreignKeyExists(runner, table, fkName)) {
      await runner.query(`ALTER TABLE ${table} DROP FOREIGN KEY ${fkName}`);
    }
  }

  // MySQL auto-creates a supporting index for a FK column when no explicit
  // index covers it, and that index defaults to the FK constraint's own
  // name — so after DROP FOREIGN KEY, a same-named index can be left behind.
  private async dropIndexIfExists(runner: QueryRunner, table: string, indexName: string): Promise<void> {
    if (await this.indexExists(runner, table, indexName)) {
      await runner.query(`ALTER TABLE ${table} DROP INDEX ${indexName}`);
    }
  }

  // Renames a FK by dropping and re-adding under the new name (MySQL has no
  // direct "RENAME CONSTRAINT" for foreign keys). Idempotent: if the new
  // name already exists, does nothing; if neither exists, does nothing.
  private async renameForeignKey(
    runner: QueryRunner,
    table: string,
    oldName: string,
    newName: string,
    addNewSql: string,
  ): Promise<void> {
    if (await this.foreignKeyExists(runner, table, newName)) return;
    if (await this.foreignKeyExists(runner, table, oldName)) {
      await runner.query(`ALTER TABLE ${table} DROP FOREIGN KEY ${oldName}`);
    }
    await runner.query(addNewSql);
  }
}
