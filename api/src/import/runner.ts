import { Prisma, PrismaClient } from '@prisma/client';
import { runUnscoped, runWithTenant } from '../common/tenant/tenant-store';
import { toDateColumn, toTimeColumn } from '../common/utils/prisma-date.util';
import { IdMap } from './id-map';
import { BACKFILL_PASSES, TABLE_PLANS } from './plan';
import type { RowOutcome, TablePlan } from './plan-types';
import { expectedSourceColumns } from './plan-types';
import type { SourceReader } from './source-reader';
import { loadTargetSchema, type TargetSchema } from './target-schema';

/**
 * The write side of the import (REQ-IMPORT-01.2, 01.4).
 *
 * Writes go through the **extended** Prisma client inside
 * `runWithTenant(tenantId, ...)`, so `tenant_id` is injected by the scoping
 * extension on every row rather than being set by hand. That is the project's
 * rule and it earns its keep here more than anywhere: this script writes to
 * roughly forty tables, and the one it forgot would be the one that leaks. It
 * also means the stored credentials in `email_provider_config` are encrypted on
 * write by the other extension, with nothing in this file calling
 * `encryptSecret`.
 *
 * One transaction per table, not one for the whole import, per
 * REQ-IMPORT-01.4 — so a failure partway through leaves a clear boundary of
 * what completed rather than an all-or-nothing multi-hour transaction that
 * MySQL would struggle to hold open anyway.
 */

export interface RunOptions {
  readonly slug: string;
  readonly domain: string;
  readonly dryRun: boolean;
  readonly withEmailCredentials: boolean;
}

export interface TableResult {
  readonly source: string;
  readonly sourceRows: number;
  readonly imported: number;
  readonly skipped: { reason: string; count: number }[];
}

export interface RunReport {
  readonly tenantId: number | null;
  readonly tables: TableResult[];
  readonly backfills: { name: string; describe: string; rows: number }[];
  readonly notes: string[];
  readonly dryRun: boolean;
}

/**
 * Creates the tenant the import writes into, and refuses a second run.
 *
 * **Seeds nothing, which is the opposite of how every other community is
 * made.** `tenants-admin.service.create` and `provision-tenant.ts` both give a
 * new tenant a city list, an achievement catalogue, legal `app_config` rows, an
 * `email_provider_config` row and a first admin. Every one of those would
 * collide here: the achievement catalogue on `(tenant_id, key)` — and those keys
 * are identifiers `member_achievements` joins on, so a merge would silently
 * repoint earned badges — the cities on `(tenant_id, name)`, the config rows on
 * `(tenant_id, config_key)`, `email_provider_config` on its one-row-per-tenant
 * unique, and the admin on `(tenant_id, email)` against whichever v1 member
 * holds that address.
 *
 * So the import brings all of it from v1 instead, which is also the only way
 * the community keeps *its* catalogue copy, *its* branding and *its* admins.
 * CLAUDE.md's "creating a tenant creates its first admin" is satisfied by the
 * import rather than by a seed, and `validate()` checks that it actually was —
 * a community with no admin is a dead end, because registration is invite-gated.
 *
 * Never root: `is_root` and `root_marker` are written together as false/NULL
 * with no way to override them, exactly as `provision-tenant.ts` does. Root is
 * the platform's own community and `bootstrap.ts` owns it.
 */
export async function createTenant(
  prisma: PrismaClient,
  options: RunOptions,
): Promise<{ tenantId: number }> {
  // REQ-IMPORT-01.1: fail fast, before writing anything, if the target already
  // exists. This is also REQ-IMPORT-01.4's re-run refusal, and the two are the
  // same check — running twice against the same target must be refused rather
  // than silently duplicating, and the tenant row is what makes "the same
  // target" decidable.
  const existing = await runUnscoped('checking whether the import target already exists', async () =>
    prisma.tenants.findFirst({
      where: { OR: [{ domain: options.domain }, { slug: options.slug }] },
    }),
  );

  if (existing) {
    throw new Error(
      `Refusing to import: tenant #${existing.id} already exists as "${existing.slug}" ` +
        `-> ${existing.domain}. Running again against the same target would duplicate every ` +
        'row rather than updating anything (REQ-IMPORT-01.4). Delete that community, or ' +
        'import into a different slug and domain.',
    );
  }

  const root = await runUnscoped('checking the deployment has a root tenant', async () =>
    prisma.tenants.findFirst({ where: { rootMarker: true } }),
  );
  if (!root) {
    throw new Error(
      'No root tenant exists — run bootstrap.js first. Importing into a deployment with no ' +
        'root would leave it with no system admin.',
    );
  }

  if (options.dryRun) {
    // Nothing is written, so there is no id. The runner reads this as "report
    // counts only", and every write path asserts on it rather than trusting the
    // caller to have checked.
    return { tenantId: 0 };
  }

  const tenant = await runUnscoped('creating the imported community', async () =>
    prisma.tenants.create({
      data: {
        slug: options.slug,
        domain: options.domain,
        status: 'active',
        isRoot: false,
        rootMarker: null,
      },
    }),
  );

  return { tenantId: tenant.id };
}

/** Runs the whole plan. */
export async function runImport(
  prisma: PrismaClient,
  source: SourceReader,
  options: RunOptions,
): Promise<RunReport> {
  const { tenantId } = await createTenant(prisma, options);

  // Read once, before the first table: which target columns are NOT NULL with a
  // default, so a NULL arriving from v1 falls to the default instead of being
  // written. See target-schema.ts for why this is a query rather than a DMMF
  // lookup.
  const target = await loadTargetSchema(prisma);

  const ids = new IdMap();
  const notes: string[] = [];
  const note = (message: string): void => {
    notes.push(message);
  };
  const tables: TableResult[] = [];

  for (const plan of TABLE_PLANS) {
    tables.push(await runTable(prisma, source, plan, { ...options, tenantId, ids, note, target }));
  }

  const backfills: RunReport['backfills'] = [];
  for (const pass of BACKFILL_PASSES) {
    const rows = await pass.run({
      tenantId,
      ids,
      withEmailCredentials: options.withEmailCredentials,
      note,
      dryRun: options.dryRun,
      fetch: (table, columns) => source.readAll(table, columns),
      update: async (model, id, data) => {
        if (options.dryRun) return;
        await runWithTenant(tenantId, async () => {
          await modelDelegate(prisma, model).update({ where: { id }, data });
        });
      },
      create: async (model, data) => {
        if (options.dryRun) return;
        await runWithTenant(tenantId, async () => {
          await modelDelegate(prisma, model).create({ data });
        });
      },
      upsert: async (model, where, data) => {
        if (options.dryRun) return;
        await runWithTenant(tenantId, async () => {
          // Looked up and then written rather than `upsert`, because Prisma's
          // upsert needs a unique input and the scoping extension is what adds
          // the tenant half of these compound uniques -- a hand-built
          // `where: { tenantId_configKey }` would be the tenant filter by hand
          // that the extension exists to remove.
          const found = await modelDelegate(prisma, model).findFirst({ where });
          if (found) {
            await modelDelegate(prisma, model).update({ where: { id: found.id }, data });
          } else {
            await modelDelegate(prisma, model).create({ data });
          }
        });
      },
    });
    backfills.push({ name: pass.name, describe: pass.describe, rows });
  }

  return { tenantId: options.dryRun ? null : tenantId, tables, backfills, notes, dryRun: options.dryRun };
}

interface TableContext extends RunOptions {
  readonly tenantId: number;
  readonly ids: IdMap;
  readonly note: (message: string) => void;
  /** What the target columns permit, for the NULL-to-default decision. */
  readonly target: TargetSchema;
}

async function runTable(
  prisma: PrismaClient,
  source: SourceReader,
  plan: TablePlan,
  ctx: TableContext,
): Promise<TableResult> {
  // Opened before the first row, so `IdMap` can tell "this table has not been
  // reached" from "this id is not in it" for the whole of the run and not just
  // once a row happens to land.
  for (const name of plan.idMapNames ?? [plan.model]) {
    if (name) ctx.ids.open(name);
  }

  const columns = expectedSourceColumns(plan);
  const sourceRows = await source.count(plan.source);
  const skipped = new Map<string, number>();
  const recordSkip = (reason: string): void => {
    skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  };

  // Read the whole table before writing any of it, so the write is one
  // transaction rather than one per batch. These tables are small -- 62
  // members, a few thousand event rows -- and holding one in memory costs less
  // than a transaction left open across network reads from the source.
  const rows = await source.readAll(plan.source, columns, plan.orderBy ?? 'id');

  const built = rows.flatMap((row) => {
    const result = buildRow(plan, row, ctx, recordSkip);
    return result ? [{ sourceId: Number(row['id']), ...result }] : [];
  });

  if (ctx.dryRun) {
    // Counted, never written. The id map is still populated, or every table
    // after this one would report its whole contents as orphaned and the dry
    // run's counts would be meaningless past the first table. The id recorded is
    // the source id -- nothing has assigned a real one -- and on a dry run it is
    // never used as anything but a presence marker.
    for (const row of built) ctx.ids.record(row.mapName, row.sourceId, row.sourceId);
    return {
      source: plan.source,
      sourceRows,
      imported: built.length,
      skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
    };
  }

  // One transaction per table, per REQ-IMPORT-01.4: a failure partway through
  // the import leaves a clear boundary of which tables completed, rather than
  // an all-or-nothing transaction held open for the whole run.
  //
  // The ids are recorded into a local list and only merged into the shared map
  // once the transaction commits. A rolled-back table that had already
  // populated the map would leave every later table resolving foreign keys to
  // rows that do not exist.
  const assigned = await runWithTenant(ctx.tenantId, async () =>
    prisma.$transaction(
      async (tx) => {
        const out: { mapName: string; sourceId: number; newId: number }[] = [];
        for (const row of built) {
          const created = (await modelDelegate(tx as unknown as PrismaClient, row.model).create({
            data: row.data,
            select: { id: true },
          })) as { id: number };
          out.push({ mapName: row.mapName, sourceId: row.sourceId, newId: created.id });
        }
        return out;
      },
      // The default 5s is for a request; a table import is not one. Generous
      // rather than tuned: the cost of a too-short timeout is a half-done
      // import, and the cost of a long one is nothing, since this script is the
      // only thing touching the new tenant.
      { timeout: 10 * 60 * 1000, maxWait: 30 * 1000 },
    ),
  );

  for (const row of assigned) ctx.ids.record(row.mapName, row.sourceId, row.newId);

  return {
    source: plan.source,
    sourceRows,
    imported: assigned.length,
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
  };
}

/**
 * Applies the plan's column rules to one source row, then lets the transform
 * have the last word.
 *
 * Returns `undefined` when the row is not to be written, having already
 * recorded why.
 *
 * Exported for `runner.spec.ts`: this is the FK-remapping logic REQ-IMPORT-01's
 * unit testing requirement names, and it is worth testing without a database on
 * either side of it.
 */
export function buildRow(
  plan: TablePlan,
  row: Record<string, unknown>,
  ctx: TableContext,
  recordSkip: (reason: string) => void,
): { model: string; mapName: string; data: Record<string, unknown> } | undefined {
  const data: Record<string, unknown> = {};

  for (const [column, rule] of Object.entries(plan.columns)) {
    if (rule.kind === 'drop' || rule.kind === 'custom') continue;

    if (rule.kind === 'copy') {
      data[rule.field] = row[column] ?? null;
      continue;
    }

    // An FK. A required one that cannot be resolved makes the row unwritable; a
    // nullable one becomes NULL. Both are orphans in the source data, and both
    // are counted -- see IdMap.
    const raw = row[column];
    if (raw === null || raw === undefined) {
      if (rule.required) {
        recordSkip(`${plan.source}.${column} is NULL but the target column is required`);
        return undefined;
      }
      data[rule.field] = null;
      continue;
    }

    const mapped = ctx.ids.resolve(rule.table, Number(raw), `${plan.source}.${column}`);
    if (mapped === undefined) {
      if (rule.required) {
        recordSkip(
          `${plan.source}.${column} points at ${rule.table}#${String(raw)}, which was not imported`,
        );
        return undefined;
      }
      recordSkip(
        `${plan.source}.${column} points at ${rule.table}#${String(raw)}, which was not ` +
          'imported; written as NULL',
      );
      data[rule.field] = null;
      continue;
    }
    data[rule.field] = mapped;
  }

  const outcome: RowOutcome | undefined = plan.transform?.(row, {
    tenantId: ctx.tenantId,
    ids: ctx.ids,
    withEmailCredentials: ctx.withEmailCredentials,
    note: ctx.note,
  });

  if (outcome?.action === 'skip') {
    recordSkip(outcome.reason);
    return undefined;
  }

  const model = outcome?.model ?? plan.model;
  if (!model) {
    throw new Error(
      `${plan.source} has no target model and its transform did not name one. A plan with ` +
        'model: null must redirect every row.',
    );
  }

  // A redirect replaces the column rules rather than merging over them: the
  // rules name fields on the plan's default model, and most of them are not
  // fields on the one being redirected to. See RowOutcome.
  const merged = outcome?.model ? (outcome.data ?? {}) : { ...data, ...(outcome?.data ?? {}) };

  // Coerced after the merge, not before, so a transform's output is covered by
  // the same rules. Several transforms hand back a raw source value —
  // `isPrivate: row['is_private']` is a MySQL TINYINT(1), which is a number —
  // and coercing only the `copy` rules would leave exactly those uncovered.
  const coerced: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(merged)) {
    const next = coerceToField(model, field, value, ctx.target);
    if (next === OMIT_FIELD) continue;

    // A NULL for a column that is NOT NULL and has no default. The row cannot
    // be written, and the useful thing is to say which column — Prisma's own
    // error for this is actively misleading: it rejects the unchecked create
    // input and reports the *checked* one's first complaint, which is a missing
    // nested relation several fields away from the actual problem. Chasing
    // `Argument 'creator' is missing` when the real answer was a null
    // `expires_at` is exactly the kind of time this script cannot afford to
    // waste on cutover day.
    const column = ctx.target.get(model)?.get(field);
    if (next === null && column && !column.nullable && !column.hasDefault) {
      recordSkip(
        `${plan.source}: ${model}.${field} is NOT NULL with no default, and the source row ` +
          'has no value for it',
      );
      return undefined;
    }

    coerced[field] = next;
  }

  return { model, mapName: outcome?.idMapName ?? model, data: coerced };
}

/**
 * Every model's scalar field types, from the generated client.
 *
 * Built once. The alternative to consulting it is coercing on the shape of the
 * *source* value, which cannot be done correctly: MySQL's `TINYINT(1)` and a
 * genuine small integer are the same wire type, so "a 0 or a 1 means a boolean"
 * turns `additional_guests = 1` into `true`.
 */
/**
 * Every model's scalar field types, from the generated client.
 *
 * Only the *type* comes from here. Nullability does not: Prisma 7's runtime
 * DMMF carries `name`, `kind`, `type` and `dbName` and nothing else, so
 * `TargetSchema` reads that from the target database — see `target-schema.ts`.
 */
const FIELD_TYPES: Map<string, Map<string, string>> = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Map(model.fields.filter((f) => f.kind !== 'object').map((f) => [f.name, f.type])),
  ]),
);

/**
 * Returned instead of a value when the field should be left out of the payload
 * entirely, so Prisma applies its own default.
 *
 * A distinct sentinel rather than `undefined`, because `undefined` is a value a
 * source row can legitimately produce and the two mean opposite things to
 * Prisma: `{ field: undefined }` and omitting `field` are the same, but
 * confusing "omit" with "the source held nothing" loses the distinction between
 * a column that defaults and one that is genuinely nullable.
 */
export const OMIT_FIELD = Symbol('omit');

/**
 * Converts a source value to what Prisma expects for the column it is going
 * into.
 *
 * **The boolean case is why this exists**, and it is a bug that would have
 * reached the real run: MySQL has no boolean type, so v1 stores every flag as
 * `TINYINT(1)` and mysql2 returns `0` or `1`. Prisma's validator rejects an Int
 * for a Boolean field outright — `Argument 'isActive': Invalid value provided.
 * Expected Boolean, provided Int` — so the first table with a flag on it fails,
 * which on this plan is `cities`, the very first table.
 *
 * Driven by the *target* field's declared type rather than by the source
 * value's shape, because the two are indistinguishable at the wire level: a
 * `TINYINT(1)` flag and a small count both arrive as a number, and a rule like
 * "a 0 or a 1 is a boolean" would turn `additional_guests = 1` into `true`.
 *
 * Anything else is passed through untouched. In particular `Decimal` stays the
 * string mysql2 produces — which is correct, and deliberately not parsed
 * through a float: a venue's latitude is exactly the kind of value that loses
 * its last digit to binary floating point.
 */
export function coerceToField(
  model: string | null,
  field: string,
  value: unknown,
  target?: TargetSchema,
): unknown {
  if (value === null || value === undefined) {
    // A NULL arriving for a column v2 declares NOT NULL. Writing it fails, and
    // not in an obvious way: Prisma rejects `null` for a required field by
    // falling back to the *checked* create input, whose error then names some
    // unrelated foreign-key scalar as the unknown argument. The column has a
    // default, so leaving it out is both correct and what the default is for.
    //
    // v1's own columns are NOT NULL wherever v2's are, so this does not fire on
    // the real database — it is what stops a schema difference becoming a
    // confusing failure pointing at the wrong column.
    const column = model ? target?.get(model)?.get(field) : undefined;
    if (column && !column.nullable && column.hasDefault) return OMIT_FIELD;
    return null;
  }

  const type = model ? FIELD_TYPES.get(model)?.get(field) : undefined;

  if (type === 'Boolean') {
    // Buffer is included because MySQL's BIT columns arrive that way, and v1
    // has used both BIT and TINYINT(1) for flags over its life.
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'bigint') return value !== 0n;
    if (Buffer.isBuffer(value)) return value.some((byte) => byte !== 0);
    if (typeof value === 'string') return value !== '' && value !== '0';
    return Boolean(value);
  }

  if (type === 'Int' && typeof value === 'string') {
    // A count that came back as a string, which mysql2 does for anything it
    // treats as a big number. Prisma wants an Int.
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }

  if (type === 'BigInt' && typeof value === 'string') return BigInt(value);

  if (type === 'DateTime' && typeof value === 'string') {
    // A bare DATE or TIME column. mysql2 hands both back as strings — DATE
    // because the reader asks it to (a date with no timezone must not become a
    // Date and be converted twice), TIME because the driver always does. Prisma
    // wants a DateTime and rejects either outright: `premature end of input.
    // Expected ISO-8601 DateTime`.
    //
    // Both are anchored to UTC by the same two helpers the rest of the codebase
    // writes these columns with, so they round-trip through
    // `toDateString`/`toTimeString` unchanged. Parsing without the explicit Z
    // applies the host's offset, which moves a date to the previous day in any
    // negative-offset timezone.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return toDateColumn(value);
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return toTimeColumn(value);
    return new Date(value);
  }

  return value;
}

/**
 * A Prisma model delegate by name.
 *
 * The plan names its targets as strings, so this is the one unavoidable
 * `any`-shaped lookup in the import. Confined to one function with one cast
 * rather than spread across every call site, and the model names it is given
 * are checked against the generated client by `runner.spec.ts` — so a renamed
 * model fails a test rather than failing at row one of a live import.
 */
interface ModelDelegate {
  create: (args: { data: Record<string, unknown>; select?: unknown }) => Promise<unknown>;
  update: (args: { where: { id: number }; data: Record<string, unknown> }) => Promise<unknown>;
  findFirst: (args: { where: Record<string, unknown> }) => Promise<{ id: number } | null>;
  count: (args?: { where?: Record<string, unknown> }) => Promise<number>;
}

export function modelDelegate(prisma: PrismaClient, model: string): ModelDelegate {
  const delegate = (prisma as unknown as Record<string, ModelDelegate | undefined>)[model];
  if (!delegate || typeof delegate.create !== 'function') {
    throw new Error(
      `"${model}" is not a Prisma model on the generated client. The import plan names a ` +
        'model that does not exist — check schema.prisma.',
    );
  }
  return delegate;
}
