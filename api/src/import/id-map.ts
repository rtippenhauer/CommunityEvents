/**
 * The `Map<oldId, newId>` registry behind REQ-IMPORT-01.2.
 *
 * Every source table's auto-increment ids are thrown away on import: the target
 * database already holds rows from the root tenant and whatever else has been
 * provisioned, so source id 7 is almost certainly taken. Rows are inserted
 * letting MySQL assign the id, and the pairing is recorded here so that any
 * later row's foreign keys can be rewritten through it.
 *
 * The whole value of this file is that it distinguishes **two failures that
 * look identical at the call site** and must not be handled the same way:
 *
 *  - **The table was never imported.** `resolve('events', 4)` when no `events`
 *    row has been read yet is a bug in the *plan* — either the table is missing
 *    from it or it is sequenced after something that depends on it. Nothing
 *    about the source data can make this right, and continuing writes a foreign
 *    key pointing at another tenant's row. It throws.
 *
 *  - **The table was imported and this id is not in it.** That is an orphaned
 *    row in the *source* data: an RSVP whose event was hard-deleted, a comment
 *    by a user who is gone. Real v1 data has these, they are not a programming
 *    error, and the import must carry on and report them — REQ-IMPORT-01.4's
 *    "rows skipped and why". It returns `undefined` and the caller decides
 *    whether that nulls a nullable column or skips the row.
 *
 * Collapsing the two is how an import silently produces cross-tenant foreign
 * keys, which is exactly what REQ-IMPORT-01.5's final check looks for and the
 * hardest thing to find afterwards.
 */

/**
 * A table whose rows are being remapped. Declared by `open()` before any of its
 * rows are read, which is what lets `resolve()` tell "not imported" from "not
 * found".
 */
export class IdMap {
  private readonly tables = new Map<string, Map<number, number>>();

  /**
   * Declare that `table` is part of this import.
   *
   * Called as the plan reaches each table, before its first row, so the window
   * in which a lookup could be ambiguous is never open: either the table has
   * been reached (and a missing id means an orphan) or it has not (and a lookup
   * is a sequencing bug).
   *
   * Idempotent, because a table may legitimately be opened by a re-entrant
   * step; re-opening never discards recorded pairs.
   */
  open(table: string): void {
    if (!this.tables.has(table)) this.tables.set(table, new Map());
  }

  /** Whether `table` has been reached yet. */
  isOpen(table: string): boolean {
    return this.tables.has(table);
  }

  /**
   * Record that source row `oldId` in `table` was written as `newId`.
   *
   * Refuses to overwrite an existing pairing rather than taking the later one.
   * A second `newId` for the same `oldId` means the same source row was
   * inserted twice, which is the shape a re-run against a half-finished target
   * takes — and the first mapping is the one every row written since has
   * already pointed at, so quietly replacing it corrupts work already done.
   */
  record(table: string, oldId: number, newId: number): void {
    const map = this.tables.get(table);
    if (!map) {
      throw new IdMapSequencingError(
        `Recorded ${table}#${oldId} -> #${newId} before ${table} was opened. ` +
          'Call IdMap.open(table) as the plan reaches it.',
      );
    }
    const existing = map.get(oldId);
    if (existing !== undefined && existing !== newId) {
      throw new IdMapSequencingError(
        `${table}#${oldId} is already mapped to #${existing}; refusing to remap it to #${newId}. ` +
          'The same source row has been imported twice.',
      );
    }
    map.set(oldId, newId);
  }

  /**
   * The new id for a source id, or `undefined` if that source row was not
   * imported.
   *
   * Throws only for the sequencing failure described in the file comment.
   * `usage` names the column being rewritten and appears in that message —
   * a bare table name is not enough to find the offending mapping in a plan
   * with several foreign keys into the same table.
   */
  resolve(table: string, oldId: number, usage: string): number | undefined {
    const map = this.tables.get(table);
    if (!map) {
      throw new IdMapSequencingError(
        `${usage} needs a ${table} id, but ${table} has not been imported yet. ` +
          `Move ${table} earlier in the table plan.`,
      );
    }
    return map.get(oldId);
  }

  /**
   * The same lookup for a nullable foreign key: `null` in, `null` out, without
   * consulting the map.
   *
   * Separate from `resolve` because `null` and "not imported" are different
   * answers that both want a null written, and a caller that handles them with
   * one branch cannot report the second — an orphaned nullable key is still
   * worth a line in the summary even though it is not fatal.
   */
  resolveNullable(
    table: string,
    oldId: number | null | undefined,
    usage: string,
  ): { value: number | null; orphaned: boolean } {
    if (oldId === null || oldId === undefined) return { value: null, orphaned: false };
    const mapped = this.resolve(table, oldId, usage);
    return mapped === undefined
      ? { value: null, orphaned: true }
      : { value: mapped, orphaned: false };
  }

  /** How many rows of `table` have been imported. The dry run's counts. */
  size(table: string): number {
    return this.tables.get(table)?.size ?? 0;
  }

  /** Every table reached so far, in the order it was opened. */
  openedTables(): string[] {
    return [...this.tables.keys()];
  }
}

/**
 * A plan-level fault: a lookup against a table the plan has not reached, or the
 * same source row imported twice.
 *
 * Its own class so the runner can let it escape while still catching and
 * reporting per-row problems. These two are never recoverable and never the
 * source data's fault, so an import that hits one should stop with a message
 * about the plan rather than add a line to a skipped-rows report nobody reads
 * until afterwards.
 */
export class IdMapSequencingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdMapSequencingError';
  }
}
