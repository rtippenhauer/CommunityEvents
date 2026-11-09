import type { IdMap } from './id-map';

/**
 * The vocabulary the DinnerBears import plan is written in (REQ-IMPORT-01).
 *
 * The plan is declarative rather than a pile of per-table functions for one
 * reason: **it has to be checkable against the source database before anything
 * is written.** A hand-written `INSERT ... SELECT` per table is easier to read
 * and has no answer to the question that actually matters on cutover day — "is
 * there a column in the live v1 database that this import silently ignores?"
 *
 * Because every source column must carry a rule, the expected source schema is
 * derivable from the plan (`expectedSourceColumns`), and the preflight can
 * compare it against `information_schema` and refuse to run on drift. v1 is
 * still a live, deployed application taking bugfixes; a column added there
 * between now and go-live is a realistic event, and the failure it would
 * otherwise cause is silent data loss discovered months later.
 */

/** What the import does with one source column. */
export type ColumnRule =
  /** Copy the value straight across to this Prisma field. */
  | { kind: 'copy'; field: string }
  /**
   * Rewrite through an id map and write to this Prisma field.
   *
   * `required` says what an unresolvable id means. A required foreign key with
   * no mapping makes the row unwritable, so the row is skipped and reported; a
   * nullable one is written as NULL and reported. Both are orphans in the
   * source data rather than faults in the plan — see `IdMap`.
   */
  | { kind: 'fk'; field: string; table: string; required: boolean }
  /**
   * Deliberately not imported, with the reason recorded here rather than in a
   * comment.
   *
   * The reason is printed in the dry run's report, so the operator reading it
   * before cutover sees *why* a column is being dropped without reading this
   * file. A drop with a vague reason is the thing to be suspicious of.
   */
  | { kind: 'drop'; reason: string }
  /**
   * Handled by the table's `transform`, because the value does not map
   * one-to-one: it is split across two target columns, folded into a different
   * table, or combined with another column to produce one target value.
   */
  | { kind: 'custom'; reason: string };

export const copy = (field: string): ColumnRule => ({ kind: 'copy', field });
export const fk = (field: string, table: string, required = true): ColumnRule => ({
  kind: 'fk',
  field,
  table,
  required,
});
export const drop = (reason: string): ColumnRule => ({ kind: 'drop', reason });
export const custom = (reason: string): ColumnRule => ({ kind: 'custom', reason });

/** What a `transform` may do with one source row. */
export type RowOutcome =
  /**
   * Write these fields, merged over whatever the column rules produced.
   *
   * `model` redirects the row to a different target than the plan's default,
   * and `idMapName` the map its new id is recorded under. One source table
   * needs both: v1's `feedback` holds bugs, feature requests and comments in
   * one table, and v2 splits them — comments stay in the scoped `feedback`,
   * bugs and feature requests become rows of the global `system_reports`.
   *
   * Recording the two halves under *different* map names is what makes the
   * consequence self-enforcing rather than something to remember: a
   * `feedback_notes` row whose parent went to `system_reports` finds no
   * mapping in the `feedback` map, so it is skipped and reported instead of
   * being written against an id in the wrong table.
   *
   * **A redirect replaces the column rules rather than merging over them.**
   * Without `model`, `data` is merged on top of what the rules produced, which
   * is how a transform overrides one or two fields. With `model`, `data` is the
   * whole payload: the rules name fields on the plan's default model, and
   *`feedback.userId` is simply not a field on `system_reports`, so merging
   * would hand Prisma an unknown argument for every column the two models do
   * not share.
   */
  | { action: 'write'; data: Record<string, unknown>; model?: string; idMapName?: string }
  /**
   * Do not write this row, and say why in the summary.
   *
   * For a source row that has no place in v2 rather than one that failed:
   * REQ-IMPORT-01.4 wants both counted and distinguishable.
   */
  | { action: 'skip'; reason: string };

/** Everything a transform needs besides the row itself. */
export interface TransformContext {
  /** The tenant every imported row belongs to. */
  readonly tenantId: number;
  /** The id maps built so far. */
  readonly ids: IdMap;
  /**
   * Whether this run may carry stored credentials across (`--with-email-credentials`).
   *
   * Default false, so a stage rehearsal against live member data cannot
   * inherit the ability to mail them even if the deployment's own keys are
   * left in place. See `docs/CUTOVER_PLAN.md`.
   */
  readonly withEmailCredentials: boolean;
  /** Record a note for the completion summary without failing the row. */
  note(message: string): void;
}

/** One source table's import. */
export interface TablePlan {
  /** The table in the v1 database. */
  readonly source: string;
  /**
   * The Prisma model rows are written to, or `null` when the table is read for
   * its side effects only (its rows become rows of a *different* model, as
   * `users.calendar_city_filter` becomes `user_city_preferences`).
   */
  readonly model: string | null;
  /** One rule per column in the source table. Exhaustive — see the file comment. */
  readonly columns: Record<string, ColumnRule>;
  /**
   * The column to order source rows by. Defaults to `id`.
   *
   * Ordering matters for self-referencing tables: a row whose foreign key
   * points at an earlier row of its own table resolves only if that row was
   * written first, and ascending id is the order v1 created them in.
   */
  readonly orderBy?: string;
  /**
   * Every id map this table may record into, when that is more than `model`.
   *
   * Declared up front so each map is opened before the table's first row, which
   * is what keeps `IdMap`'s "not imported" and "not found" answers distinct. A
   * map opened lazily on first use would read as "not imported" for every row
   * until one happened to land in it.
   */
  readonly idMapNames?: readonly string[];
  /** Last word on what is written for a row. */
  readonly transform?: (
    row: Record<string, unknown>,
    ctx: TransformContext,
  ) => RowOutcome | undefined;
  /** Why this table is imported where it is, when that is not obvious. */
  readonly note?: string;
}

/**
 * A source table that is read by nothing, with the reason.
 *
 * Declared rather than simply absent, and the preflight treats an *undeclared*
 * source table as drift. Silence is how `facebook_group_config` would have
 * looked exactly like a table somebody forgot.
 */
export interface ExcludedTable {
  readonly source: string;
  readonly reason: string;
  /**
   * True for a table v1's own docs describe but that no migration ever created.
   * The preflight expects these to be **absent** from the source database and
   * says so if one turns up, since that would mean v1 grew it after this was
   * written.
   */
  readonly expectedAbsent?: boolean;
}

/**
 * A pass that runs after every table: to close a dependency cycle, or to write
 * rows that are derived rather than copied.
 *
 * `users` and `invites` reference each other (`users.invite_id` /
 * `invites.redeemed_by`), as do `users` and `announcements`
 * (`users.last_seen_announcement_id` / `announcements.created_by`). No ordering
 * satisfies a cycle, so those columns are written as NULL on the first pass and
 * filled in here, once both maps are complete.
 *
 * Kept as an explicit phase rather than a clever insertion order because the
 * cycle is a property of v1's schema and will not go away: a reader needs to
 * see that these columns are deliberately written twice.
 *
 * The derived passes are here for a different reason: `user_city_preferences`
 * has no source table at all — it is computed from `users.calendar_city_filter`
 * — and `feature_cities` is a flag the import sets rather than copies. Both need
 * users and cities to exist first, so this is simply where they can run.
 */
export interface BackfillPass {
  readonly name: string;
  readonly describe: string;
  readonly run: (ctx: BackfillContext) => Promise<number>;
}

export interface BackfillContext extends TransformContext {
  /** Rows of a source table, already fetched and coerced. */
  readonly fetch: (table: string, columns: string[]) => Promise<Record<string, unknown>[]>;
  /** Apply one update to the target, counted towards the pass's total. */
  readonly update: (model: string, id: number, data: Record<string, unknown>) => Promise<void>;
  /**
   * Write one derived row, counted towards the pass's total.
   *
   * `tenantId` is injected by the scoping extension exactly as it is for the
   * table passes, so a derived row cannot land in the wrong community either.
   */
  readonly create: (model: string, data: Record<string, unknown>) => Promise<void>;
  /**
   * Write one derived row, replacing any row already matching `where`.
   *
   * For a row the import must end up owning whatever the source held. v1 has no
   * `feature_cities` key today, so a plain insert would work — but v1 is still
   * taking bugfixes, and the preflight catches a new *column*, not a new config
   * *row*. An upsert costs one statement and removes the failure mode.
   */
  readonly upsert: (
    model: string,
    where: Record<string, unknown>,
    data: Record<string, unknown>,
  ) => Promise<void>;
  /** True on a dry run: no pass may write, and every one still reports its count. */
  readonly dryRun: boolean;
}

/**
 * The source columns this plan accounts for, which is every column it expects
 * the table to have.
 *
 * Used by the preflight, and the reason the column rules have to be exhaustive:
 * a column in the live database that is absent here is one this import would
 * drop without saying so.
 */
export function expectedSourceColumns(plan: TablePlan): string[] {
  return Object.keys(plan.columns);
}
