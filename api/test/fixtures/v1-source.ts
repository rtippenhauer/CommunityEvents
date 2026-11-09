import * as mysql from 'mysql2/promise';
import { V1_SCHEMA } from '../../src/import/v1-schema.fixture';

/**
 * Builds a throwaway v1-shaped database on the e2e MySQL container, for the
 * import's integration test (REQ-IMPORT-01's testing requirements).
 *
 * **The DDL is generated from `V1_SCHEMA`, not hand-written.** A hand-written
 * copy would be v1's schema written down a third time — after the entities it
 * was derived from and the fixture itself — and the one that drifted would be
 * this one, quietly turning the integration test into a test of an imaginary
 * source database that still passes.
 *
 * Column *types* are inferred from the name, with overrides for the handful
 * where the type carries meaning the name does not. That is enough because the
 * preflight compares names, and the import copies values: an ENUM is a string
 * either way, so `VARCHAR` holds v1's enums faithfully and Prisma validates
 * against its own enum on the way in. The types that genuinely matter are the
 * date ones, and those are declared.
 *
 * No foreign keys, deliberately. The fixture needs to be able to hold an
 * orphaned row — an RSVP whose event is gone — because that is a real shape in
 * v1's data and the import's skip-and-report path is what handles it. A
 * constraint here would make that case untestable.
 */

/**
 * Columns whose type is not inferable from the name, or where inferring it
 * wrong would make the test meaningless.
 */
const COLUMN_TYPES: Record<string, string> = {
  // The pair that Prisma 7 converts twice if it is ever a JS Date. A bare DATE
  // has no timezone, so a round-trip through Date shifts the dinner by a day
  // either side of midnight.
  'events.event_date': 'DATE',
  'events.event_time': 'TIME',

  // v1 stores these as JSON, and the import copies them straight across.
  'event_rsvps.guest_names': 'JSON',
  'event_rsvps.facebook_guest_names': 'JSON',
  'audit_log.metadata': 'JSON',
  'email_queue.template_params': 'JSON',
  'facebook_event_attendees.sources': 'JSON',

  // Decimals, not integers: a venue's coordinates.
  'locations.lat': 'DECIMAL(10,7)',
  'locations.lng': 'DECIMAL(10,7)',
  'events.location_lat': 'DECIMAL(10,7)',
  'events.location_lng': 'DECIMAL(10,7)',

  // Ratings are small integers, not ids, despite ending in nothing helpful.
  'location_ratings.food': 'TINYINT UNSIGNED',
  'location_ratings.service': 'TINYINT UNSIGNED',
  'location_ratings.value_rating': 'TINYINT UNSIGNED',
  'location_ratings.noise': 'TINYINT UNSIGNED',

  // Counters and point values, which the `_id`/`_at` rules would miss.
  'users.login_count': 'INT UNSIGNED',
  'users.qualifying_login_count': 'INT UNSIGNED',
  'users.failed_login_attempts': 'TINYINT UNSIGNED',
  'achievements.points': 'INT',
  'achievements.progress_target': 'INT UNSIGNED',
  'member_points.points': 'INT',
  'member_points.reference_id': 'INT UNSIGNED',
  'feedback.upvote_count': 'INT UNSIGNED',
  'invites.max_uses': 'INT UNSIGNED',
  'invites.use_count': 'INT UNSIGNED',
  'event_rsvps.additional_guests': 'TINYINT UNSIGNED',
  'event_rsvps.facebook_guest_count': 'TINYINT UNSIGNED',
  'event_facebook_links.last_going_count': 'INT UNSIGNED',
  'location_photos.sort_order': 'INT UNSIGNED',
  'avatar.sort_order': 'INT UNSIGNED',
  'audit_log.entity_id': 'INT UNSIGNED',
  'content_flags.content_id': 'INT UNSIGNED',
  'content_reports.content_id': 'INT UNSIGNED',

  // `last_reset_date` is a DATE in v1, and `email_provider_config`'s template
  // ids are nullable ints that the `_id` rule would otherwise get right anyway.
  'email_provider_config.last_reset_date': 'DATE',

  // The migrations ledger, which has no entity.
  'migrations.timestamp': 'BIGINT',
  'migrations.name': 'VARCHAR(255)',

  // Columns ending in `_id` that hold somebody *else's* identifier, not one of
  // v1's auto-increment keys. The name rule would make these integers and the
  // fixture would reject a real value — which is also the reason the import
  // never remaps them: they are not foreign keys into anything.
  'oauth_accounts.provider_id': 'VARCHAR(255) NULL',
  'event_facebook_links.facebook_event_id': 'VARCHAR(32) NULL',
  'facebook_accounts.facebook_user_id': 'VARCHAR(32) NULL',
  'facebook_deletion_requests.facebook_user_id': 'VARCHAR(255) NULL',
  // A Brevo template id, which is a string in v2's schema.
  'email_queue.template_id': 'VARCHAR(100) NULL',
};

/** A column's MySQL type, by the rules described in the file comment. */
function columnType(table: string, column: string): string {
  const override = COLUMN_TYPES[`${table}.${column}`];
  if (override) return override;

  if (column === 'id') return 'INT UNSIGNED NOT NULL AUTO_INCREMENT';
  if (column.endsWith('_id') || column === 'invited_by' || column === 'created_by') {
    return 'INT UNSIGNED NULL';
  }
  if (/^(reported_by|reviewed_by|updated_by|uploaded_by|redeemed_by|linked_by|member_id|author_id|user_id|reporter_id)$/.test(column)) {
    return 'INT UNSIGNED NULL';
  }
  if (column.endsWith('_at') || column.endsWith('_date')) return 'DATETIME NULL';
  if (/^(is_|has_)/.test(column) || column === 'attended' || column === 'brevo_enabled') {
    return 'TINYINT(1) NULL';
  }
  if (/^(resend_overflow_enabled|reservation_confirmed|reservation_seats_email_sent|calendar_rsvp_only)$/.test(column)) {
    return 'TINYINT(1) NULL';
  }
  if (/_(limit|today)$/.test(column)) return 'INT UNSIGNED NULL';
  // Everything else is text. Wide enough for any value a fixture holds, and the
  // import copies strings without inspecting their declared width.
  return 'TEXT NULL';
}

/** `CREATE TABLE` for one v1 table. */
export function createTableSql(table: string, columns: readonly string[]): string {
  const defs = columns.map((column) => `  \`${column}\` ${columnType(table, column)}`);
  if (columns.includes('id')) defs.push('  PRIMARY KEY (`id`)');
  return `CREATE TABLE \`${table}\` (\n${defs.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
}

export interface V1Fixture {
  readonly url: string;
  readonly database: string;
  /** Inserts a row and returns its id. */
  insert(table: string, row: Record<string, unknown>): Promise<number>;
  /**
   * Updates one row by id.
   *
   * Needed because v1's schema has cycles: `users.invite_id` points at a row of
   * `invites` whose `created_by` points back at `users`, so a fixture cannot
   * write both in one insert either.
   */
  update(table: string, id: number, row: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
  drop(): Promise<void>;
}

/**
 * Creates the database and every v1 table in it, empty.
 *
 * Takes the same connection the e2e suite uses, with a different database name,
 * so the integration test needs no infrastructure beyond the container that is
 * already running.
 */
export async function createV1Fixture(database = 'dinnerbears_v1_fixture'): Promise<V1Fixture> {
  const host = process.env.DB_HOST ?? '127.0.0.1';
  const port = Number(process.env.DB_PORT ?? 3307);
  const user = process.env.DB_USER ?? 'root';
  const password = process.env.DB_PASSWORD ?? 'test';

  const admin = await mysql.createConnection({ host, port, user, password });
  await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4`);
  await admin.end();

  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    timezone: 'Z',
  });

  for (const [table, columns] of Object.entries(V1_SCHEMA)) {
    await connection.query(createTableSql(table, columns));
  }

  const url = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(
    password,
  )}@${host}:${port}/${database}`;

  return {
    url,
    database,
    async insert(table, row) {
      const columns = Object.keys(row);
      const [result] = await connection.query<mysql.ResultSetHeader>(
        `INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) ` +
          `VALUES (${columns.map(() => '?').join(', ')})`,
        Object.values(row),
      );
      return result.insertId;
    },
    async update(table, id, row) {
      const columns = Object.keys(row);
      await connection.query(
        `UPDATE \`${table}\` SET ${columns.map((c) => `\`${c}\` = ?`).join(', ')} WHERE id = ?`,
        [...Object.values(row), id],
      );
    },
    async close() {
      await connection.end();
    },
    async drop() {
      const cleanup = await mysql.createConnection({ host, port, user, password });
      await cleanup.query(`DROP DATABASE IF EXISTS \`${database}\``);
      await cleanup.end();
    },
  };
}
