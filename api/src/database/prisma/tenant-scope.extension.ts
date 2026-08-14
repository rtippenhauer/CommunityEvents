import { Prisma } from '@prisma/client';
import {
  isTenantScopedModel,
  TENANT_ID_FIELD,
} from '../../common/tenant/tenant-scoped-models';
import { currentTenantId } from '../../common/tenant/tenant-store';

/**
 * The single enforcement point for tenant isolation (REQ-TENANT-01.3).
 *
 * Every query against a model in TENANT_SCOPED_MODELS gets `tenant_id` injected
 * — into `where` on reads and destructive writes, into the payload on creates —
 * so that no service has to remember to do it. The requirement is explicit that
 * this must not be left to individual services, and the reason is that the
 * failure mode of forgetting is invisible: a missing filter returns *more* data,
 * never an error.
 *
 * Three things make this stronger than a top-level `where` merge, all of which
 * exist because a query can reach tenant data without naming a scoped model at
 * the top level:
 *
 *  - **Nested writes** are walked recursively, so `events.create({ data: { rsvps:
 *    { create: [...] } } })` sets `tenant_id` on the RSVPs too. Without this
 *    they would fail the NOT NULL constraint rather than leak — loud, but only
 *    at runtime, and only on the paths someone happened to exercise.
 *  - **Nested reads** (`include` / `select` / `_count`) get the same filter, so
 *    a global parent cannot be used as a bridge to another tenant's rows.
 *  - **`connect` and friends** take the filter as well, so a row cannot be
 *    attached across a tenant boundary by id.
 *
 * What it deliberately does not cover: `$queryRaw` / `$executeRaw`, which Prisma
 * does not route through extensions at all. Those 35 call sites carry their own
 * `tenant_id` predicates; see the audit in V2_PHASES.md.
 *
 * Fails closed. No ambient context is an error, not a pass-through — see
 * tenant-store.ts for why "nobody decided" and "decided not to scope" are
 * separate states.
 */

type AnyRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is AnyRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

interface RelationInfo {
  /** The model on the other end. */
  readonly target: string;
  /** True for a to-many relation. Only these accept a `where` in an include. */
  readonly isList: boolean;
}

/**
 * model name -> (relation field name -> relation info), from the generated DMMF.
 *
 * Built from the datamodel rather than hand-maintained: the walker has to know
 * that `events.rsvps` leads to `event_rsvps` for every relation in the schema,
 * and a hand-written copy of that would drift the first time someone adds a
 * relation. Built once at module load; the DMMF is static.
 */
const RELATION_TARGETS: ReadonlyMap<string, ReadonlyMap<string, RelationInfo>> = new Map(
  Prisma.dmmf.datamodel.models.map((model) => [
    model.name,
    new Map(
      model.fields
        .filter((field) => field.kind === 'object')
        .map((field) => [field.name, { target: field.type, isList: field.isList }]),
    ),
  ]),
);

const relationsOf = (model: string): ReadonlyMap<string, RelationInfo> =>
  RELATION_TARGETS.get(model) ?? new Map();

/**
 * Adds `tenantId` to a `where`, refusing to silently override a conflicting one.
 *
 * A caller passing a different tenant's id is either a bug or an attempt to
 * cross the boundary; quietly rewriting it to the current tenant would return a
 * plausible-looking result for the wrong question. `findUnique` accepts the
 * extra non-unique field because Prisma's extendedWhereUnique behaviour has been
 * GA since v5 — which is what lets `findUnique({ where: { id } })` stay scoped
 * without being rewritten into `findFirst`.
 */
function scopeWhere(where: unknown, tenantId: number): AnyRecord {
  if (where !== undefined && !isRecord(where)) return { [TENANT_ID_FIELD]: tenantId };

  const existing = where?.[TENANT_ID_FIELD];
  if (existing !== undefined && existing !== tenantId) {
    throw new Error(
      `Refusing to run a query filtered to tenant ${String(existing)} while tenant ${tenantId} is in context.`,
    );
  }
  return { ...(where ?? {}), [TENANT_ID_FIELD]: tenantId };
}

/**
 * Stamps a create payload with the current tenant and recurses into its nested
 * writes.
 */
function scopeCreateData(model: string, data: unknown, tenantId: number): unknown {
  if (Array.isArray(data)) {
    return data.map((entry) => scopeCreateData(model, entry, tenantId));
  }
  if (!isRecord(data)) return data;

  const scoped: AnyRecord = { ...data };

  if (isTenantScopedModel(model)) {
    const existing = scoped[TENANT_ID_FIELD];
    if (existing !== undefined && existing !== tenantId) {
      throw new Error(
        `Refusing to create a ${model} row for tenant ${String(existing)} while tenant ${tenantId} is in context.`,
      );
    }
    scoped[TENANT_ID_FIELD] = tenantId;
  }

  return walkNestedWrites(model, scoped, tenantId);
}

/**
 * Scopes an update payload.
 *
 * `tenant_id` is not writable. The `where` clause has already restricted the
 * statement to the current tenant, so allowing `data.tenantId` through would let
 * an update *move* a row out of the tenant that owns it — a write-side leak that
 * a read-side filter cannot catch. Throwing rather than stripping keeps it from
 * looking like it worked.
 */
function scopeUpdateData(model: string, data: unknown, tenantId: number): unknown {
  if (!isRecord(data)) return data;

  if (isTenantScopedModel(model) && data[TENANT_ID_FIELD] !== undefined) {
    throw new Error(
      `${model}.${TENANT_ID_FIELD} is not writable: a row cannot be moved between tenants.`,
    );
  }

  return walkNestedWrites(model, { ...data }, tenantId);
}

/**
 * Applies scoping to every nested-write operator hanging off a relation field.
 *
 * Recurses through relations to unscoped models as well — a nested create on a
 * global model can still contain a nested create on a scoped one.
 */
function walkNestedWrites(model: string, payload: AnyRecord, tenantId: number): AnyRecord {
  const relations = relationsOf(model);

  for (const [field, value] of Object.entries(payload)) {
    const relation = relations.get(field);
    if (relation === undefined || !isRecord(value)) continue;
    payload[field] = scopeNestedWrite(relation.target, value, tenantId);
  }

  return payload;
}

function scopeNestedWrite(target: string, nested: AnyRecord, tenantId: number): AnyRecord {
  const scoped: AnyRecord = { ...nested };
  const scopedTarget = isTenantScopedModel(target);

  // Each key can be a single object or an array of them, and the shapes differ
  // per operator, so they are handled individually rather than generically.
  const eachOf = (value: unknown, fn: (entry: AnyRecord) => AnyRecord): unknown => {
    if (Array.isArray(value)) return value.map((entry) => (isRecord(entry) ? fn(entry) : entry));
    return isRecord(value) ? fn(value) : value;
  };

  if (scoped.create !== undefined) {
    scoped.create = scopeCreateData(target, scoped.create, tenantId);
  }

  if (isRecord(scoped.createMany)) {
    // createMany cannot contain further nesting, so this only stamps the rows.
    scoped.createMany = {
      ...scoped.createMany,
      data: scopeCreateData(target, scoped.createMany.data, tenantId),
    };
  }

  if (scoped.connectOrCreate !== undefined) {
    scoped.connectOrCreate = eachOf(scoped.connectOrCreate, (entry) => ({
      ...entry,
      where: scopedTarget ? scopeWhere(entry.where, tenantId) : entry.where,
      create: scopeCreateData(target, entry.create, tenantId),
    }));
  }

  if (scoped.upsert !== undefined) {
    scoped.upsert = eachOf(scoped.upsert, (entry) => ({
      ...entry,
      where: scopedTarget ? scopeWhere(entry.where, tenantId) : entry.where,
      create: scopeCreateData(target, entry.create, tenantId),
      update: scopeUpdateData(target, entry.update, tenantId),
    }));
  }

  for (const operator of ['update', 'updateMany'] as const) {
    if (scoped[operator] === undefined) continue;
    scoped[operator] = eachOf(scoped[operator], (entry) => {
      // A to-one `update` may be the payload itself rather than {where, data}.
      if (entry.data === undefined) return scopeUpdateData(target, entry, tenantId) as AnyRecord;
      return {
        ...entry,
        where: scopedTarget ? scopeWhere(entry.where, tenantId) : entry.where,
        data: scopeUpdateData(target, entry.data, tenantId),
      };
    });
  }

  // Pure `where` operators. `delete`/`disconnect` on a to-one relation can be
  // `true`, which carries no where to scope and is already constrained by the
  // parent's foreign key.
  if (scopedTarget) {
    for (const operator of [
      'connect',
      'disconnect',
      'set',
      'delete',
      'deleteMany',
    ] as const) {
      const value = scoped[operator];
      if (value === undefined || typeof value === 'boolean') continue;
      scoped[operator] = eachOf(value, (entry) => scopeWhere(entry, tenantId) as AnyRecord);
    }
  }

  return scoped;
}

/**
 * Applies the filter to `include` / `select` / `_count`, so related rows come
 * back scoped too.
 *
 * `include: { rsvps: true }` becomes `include: { rsvps: { where: { tenantId } } }`
 * — same rows for a correctly-scoped caller, nothing for a cross-tenant one.
 * This is what stops a model that is still global (today: `users`) from being
 * used as a bridge into another tenant's data.
 *
 * **Only to-many relations can be filtered.** Prisma accepts no `where` on a
 * to-one include — it is a single row reached by foreign key, and passing one is
 * a validation error rather than a no-op, which is how this was found. A to-one
 * hop into a scoped model is therefore covered by the FK itself: the extension
 * refuses to `connect` across tenants, so the row on the other end belongs to
 * the same tenant as the row pointing at it. The exception is a to-one hop from
 * a *global* parent — `releases -> release_feedback -> feedback` is the one such
 * chain in the schema today — where nothing constrains the target. Closing that
 * needs the query rewritten to anchor on the scoped model, not a filter here.
 */
function scopeReadShape(model: string, shape: unknown, tenantId: number): unknown {
  if (!isRecord(shape)) return shape;

  const relations = relationsOf(model);
  const scoped: AnyRecord = { ...shape };

  for (const [field, value] of Object.entries(scoped)) {
    // Relation counts nest one level deeper and are filterable in their own
    // right; an unscoped _count leaks other tenants' totals even when the rows
    // themselves stay hidden. Counts only exist for to-many relations.
    if (field === '_count' && isRecord(value) && isRecord(value.select)) {
      scoped._count = { ...value, select: scopeReadShape(model, value.select, tenantId) };
      continue;
    }

    const relation = relations.get(field);
    if (relation === undefined) continue;

    const filterable = relation.isList && isTenantScopedModel(relation.target);

    if (value === true) {
      scoped[field] = filterable ? { where: { [TENANT_ID_FIELD]: tenantId } } : true;
      continue;
    }

    if (!isRecord(value)) continue;

    const nested: AnyRecord = { ...value };
    if (filterable) {
      nested.where = scopeWhere(nested.where, tenantId);
    }
    if (nested.include !== undefined) {
      nested.include = scopeReadShape(relation.target, nested.include, tenantId);
    }
    if (nested.select !== undefined) {
      nested.select = scopeReadShape(relation.target, nested.select, tenantId);
    }
    scoped[field] = nested;
  }

  return scoped;
}

/**
 * Operations whose `data` argument is a create payload rather than an update.
 * `createManyAndReturn` and `updateManyAndReturn` are listed explicitly so a
 * future Prisma operation is not silently mis-handled by a prefix match.
 */
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATE_OPERATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

export const tenantScopeExtension = Prisma.defineExtension({
  name: 'tenant-scoping',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!isTenantScopedModel(model)) {
          // Still walk the arguments: a global model can nest into a scoped one
          // in either direction (a `users` read including their `notifications`,
          // a `users` create nesting a `login_sessions` create).
          const tenantId = currentTenantId();
          if (typeof tenantId !== 'number' || !isRecord(args)) return query(args);
          return query(scopeArguments(model ?? '', operation, args, tenantId, false));
        }

        const tenantId = currentTenantId();

        if (tenantId === null) return query(args); // runUnscoped: deliberate waiver

        if (tenantId === undefined) {
          throw new Error(
            `No tenant context for ${model}.${operation}. Tenant-scoped models cannot be ` +
              `queried outside a request; wrap system work in runUnscoped('<reason>', ...).`,
          );
        }

        return query(scopeArguments(model, operation, isRecord(args) ? args : {}, tenantId, true));
      },
    },
  },
});

/**
 * Rewrites one operation's arguments.
 *
 * Keyed off which arguments are actually present rather than off a per-operation
 * table, so an operation Prisma adds later is scoped by default instead of
 * falling through unfiltered.
 */
function scopeArguments(
  model: string,
  operation: string,
  args: AnyRecord,
  tenantId: number,
  scopeTopLevel: boolean,
): AnyRecord {
  const scoped: AnyRecord = { ...args };

  if (scopeTopLevel) {
    // `upsert` is the one operation carrying both a create and an update
    // payload, and its `where` must be scoped like any other.
    if (operation === 'upsert') {
      scoped.where = scopeWhere(scoped.where, tenantId);
      scoped.create = scopeCreateData(model, scoped.create, tenantId);
      scoped.update = scopeUpdateData(model, scoped.update, tenantId);
    } else {
      if (!CREATE_OPERATIONS.has(operation)) {
        scoped.where = scopeWhere(scoped.where, tenantId);
      }
      if (CREATE_OPERATIONS.has(operation) && scoped.data !== undefined) {
        scoped.data = scopeCreateData(model, scoped.data, tenantId);
      }
      if (UPDATE_OPERATIONS.has(operation) && scoped.data !== undefined) {
        scoped.data = scopeUpdateData(model, scoped.data, tenantId);
      }
    }
  } else {
    // Unscoped model: no top-level filter, but its payloads still nest.
    if (CREATE_OPERATIONS.has(operation) && scoped.data !== undefined) {
      scoped.data = scopeCreateData(model, scoped.data, tenantId);
    }
    if (UPDATE_OPERATIONS.has(operation) && scoped.data !== undefined) {
      scoped.data = scopeUpdateData(model, scoped.data, tenantId);
    }
    if (operation === 'upsert') {
      if (scoped.create !== undefined) {
        scoped.create = scopeCreateData(model, scoped.create, tenantId);
      }
      if (scoped.update !== undefined) {
        scoped.update = scopeUpdateData(model, scoped.update, tenantId);
      }
    }
  }

  if (scoped.include !== undefined) {
    scoped.include = scopeReadShape(model, scoped.include, tenantId);
  }
  if (scoped.select !== undefined) {
    scoped.select = scopeReadShape(model, scoped.select, tenantId);
  }

  return scoped;
}
