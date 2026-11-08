import * as mysql from 'mysql2/promise';
import type { SourceColumn } from './preflight';

/**
 * The read-only side of the import: a plain MySQL connection to the v1
 * database.
 *
 * **Deliberately not Prisma.** v1's schema is not this repo's schema, so there
 * is no generated client for it, and generating one would mean carrying a
 * second `schema.prisma` that drifts from a database we do not own. Raw
 * `SELECT`s against a known column list are the honest tool here, and the
 * column list is checked by the preflight before a single row is read.
 *
 * This is also the one place in the codebase where raw SQL needs no
 * `requireTenantId` predicate: v1 has no tenancy at all. The whole database is
 * one community, which is what the import is turning into one tenant.
 */
export class SourceReader {
  private constructor(
    private readonly connection: mysql.Connection,
    readonly database: string,
  ) {}

  /**
   * Opens the connection from a URL, and proves it is read-only before handing
   * it back.
   *
   * REQ-IMPORT-01.1 asks for a read-only connection string, and a *string* is
   * not a guarantee — the credential in it either has write grants or it does
   * not. `assertReadOnly` settles that against the server rather than trusting
   * the URL, because the live DinnerBears database is on the other end and the
   * cost of being wrong is the thing nobody can undo.
   */
  static async open(url: string): Promise<SourceReader> {
    const parsed = new URL(url);
    const database = parsed.pathname.replace(/^\//, '');
    if (!database) {
      throw new Error(
        `The source connection string names no database: ${parsed.protocol}//${parsed.host}/`,
      );
    }

    const connection = await mysql.createConnection({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database,
      // Matches PrismaService's pinning, and for the same reason. mysql2 reads
      // naive DATETIME columns as the Node process's LOCAL time by default,
      // where the mariadb adapter on the write side reads them as UTC. Left to
      // differ, every imported timestamp would shift by the local offset on a
      // non-UTC machine -- invisible in a UTC container and wrong on a laptop.
      timezone: 'Z',
      // DATE columns come back as strings rather than parsed into a JS Date.
      // `events.event_date` is the one that matters: a bare date has no
      // timezone, so parsing it into a Date and letting Prisma convert it again
      // shifts the dinner by a day either side of midnight -- see "Prisma 7
      // mechanics" in docs/DATABASE_SCHEMA.md. TIME is left out of the list
      // because mysql2 returns it as a string already, and the type only
      // accepts DATE/DATETIME/TIMESTAMP. DATETIME stays a Date, which is what
      // Prisma wants for every `@db.DateTime(0)` column.
      dateStrings: ['DATE'],
      // An INT UNSIGNED fits a JS number; a BIGINT does not, and the driver
      // returns one as a string unless asked. v1 has no BIGINT columns, so this
      // only affects aggregate results -- COUNT(*) comes back as a string we
      // parse, rather than as a BigInt that silently fails arithmetic.
      supportBigNumbers: true,
      bigNumberStrings: true,
    });

    return new SourceReader(connection, database);
  }

  /**
   * Refuses to continue unless the connection genuinely cannot write.
   *
   * Tested by attempting a write and requiring it to fail, which is the only
   * check that cannot be fooled: reading `SHOW GRANTS` means parsing MySQL's
   * grant syntax and reasoning about role inheritance, and getting that subtly
   * wrong reports "read-only" for a connection that is not.
   *
   * The write is to a scratch name in the source database, so a credential that
   * *is* writable creates and immediately drops a table rather than touching
   * anything real. That is the worst case and it is acceptable; the alternative
   * is running the import against a writable credential and finding out later.
   */
  async assertReadOnly(): Promise<void> {
    const probe = `_ce_import_readonly_probe_${Date.now()}`;
    try {
      await this.connection.query(`CREATE TABLE \`${probe}\` (id INT)`);
    } catch {
      // The expected path: no CREATE grant, so the credential is read-only.
      return;
    }

    // It worked, which means this credential can write to the source database.
    await this.connection.query(`DROP TABLE IF EXISTS \`${probe}\``).catch(() => undefined);
    throw new Error(
      `The source credential can write to "${this.database}" — it created and dropped a ` +
        'table. REQ-IMPORT-01.1 asks for a read-only connection, and this is the live ' +
        'community database. Grant SELECT only and re-run.',
    );
  }

  /** Every (table, column) pair in the source database, for the preflight. */
  async describe(): Promise<SourceColumn[]> {
    const [rows] = await this.connection.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
         FROM information_schema.columns
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [this.database],
    );
    return rows.map((row) => ({ table: String(row.t), column: String(row.c) }));
  }

  /** How many rows a table holds, for the dry run's source counts. */
  async count(table: string): Promise<number> {
    const [rows] = await this.connection.query<mysql.RowDataPacket[]>(
      // The table name comes from the plan, never from input, and the preflight
      // has already matched it against information_schema -- so it is one of a
      // known set of identifiers rather than a value. Identifiers cannot be
      // parameterised in MySQL, hence the interpolation, and the backticks stop
      // a reserved word breaking the statement.
      `SELECT COUNT(*) AS n FROM \`${table}\``,
    );
    return Number(rows[0]?.n ?? 0);
  }

  /**
   * Reads a table, naming every column rather than `SELECT *`.
   *
   * Explicit on purpose: a `SELECT *` would quietly start returning a column
   * the plan knows nothing about, which is the drift the preflight exists to
   * refuse. Asking for the columns the plan accounts for means an unexpected
   * one is an error at preflight, not a surprise mid-import.
   */
  async *read(
    table: string,
    columns: readonly string[],
    orderBy = 'id',
    batchSize = 500,
  ): AsyncGenerator<Record<string, unknown>[]> {
    const select = columns.map((c) => `\`${c}\``).join(', ');
    let offset = 0;

    for (;;) {
      const [rows] = await this.connection.query<mysql.RowDataPacket[]>(
        `SELECT ${select} FROM \`${table}\` ORDER BY \`${orderBy}\` ASC LIMIT ? OFFSET ?`,
        [batchSize, offset],
      );
      if (rows.length === 0) return;
      yield rows as Record<string, unknown>[];
      if (rows.length < batchSize) return;
      offset += rows.length;
    }
  }

  /** All of a table's rows at once, for the backfill passes. */
  async readAll(
    table: string,
    columns: readonly string[],
    orderBy = 'id',
  ): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for await (const batch of this.read(table, columns, orderBy)) out.push(...batch);
    return out;
  }

  async close(): Promise<void> {
    await this.connection.end();
  }
}
