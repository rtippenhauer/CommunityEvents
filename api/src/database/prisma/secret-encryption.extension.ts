import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { encryptedFieldsOf } from '../../common/crypto/encrypted-columns';
import {
  decryptSecret,
  encryptSecret,
  type SecretContext,
} from '../../common/crypto/secret-cipher';
import { relationsOf } from './model-relations';

/**
 * The single enforcement point for encryption at rest (v2-7).
 *
 * Every column in ENCRYPTED_COLUMNS is encrypted on the way into the database
 * and decrypted on the way out, so a service reads and writes plaintext and a
 * database dump contains none. This is the argument tenant scoping makes, and
 * it applies more sharply here: a service that forgets to encrypt does not
 * fail, it succeeds. The credential works, the screen looks right, and the
 * plaintext is discovered later by whoever finds the backup.
 *
 * ## Where it sits
 *
 * Applied after `tenantScopeExtension`, which makes it the outer of the two: it
 * sees the caller's arguments before scoping rewrites them, and the rows after.
 * The two do not interact — scoping only ever touches `tenantId` and `where`,
 * encryption only the declared string columns — so the order is a matter of
 * legibility rather than correctness.
 *
 * ## What it covers
 *
 *  - **Writes**, including nested ones: a `tenants.create` nesting
 *    `tenant_secrets` rows encrypts those rows too, and the `{ set: value }`
 *    update form is handled alongside the bare one.
 *  - **Reads**, including relations: a row reached through `include` or
 *    `select` comes back decrypted, at any depth.
 *
 * ## What it deliberately refuses
 *
 * Filtering or ordering by an encrypted column **throws**. The cipher is
 * randomised, so `where: { brevoApiKey: someKey }` cannot match — it would
 * return no rows, read as "no such key", and be wrong. An error at the call
 * site is the only outcome that tells the truth.
 *
 * ## What it does not cover
 *
 * `$queryRaw` / `$executeRaw`, which Prisma does not route through extensions —
 * the same hole tenant scoping has, and the same rule follows: raw SQL touching
 * an encrypted column has to call `encryptSecret`/`decryptSecret` itself. No
 * raw statement in the codebase touches one today (`bootstrap.ts` writes the
 * `email_provider_config` row without either API key, and the `tenants` OAuth
 * columns are still unwritten), so the rule is stated here rather than
 * demonstrated anywhere. `rewrap-secrets.ts` is the deliberate exception that
 * bypasses this extension entirely, because rewrapping through it would be a
 * no-op that reported success.
 */

type AnyRecord = Record<string, unknown>;

const logger = new Logger('SecretEncryption');

const isRecord = (value: unknown): value is AnyRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Columns already reported as holding legacy plaintext.
 *
 * The warning matters once per column per process — it is telling an operator
 * to run the rewrap script, which is not advice that improves with repetition,
 * and the alternative is a log line per row per request.
 */
const legacyWarned = new Set<string>();

const warnLegacy = (context: SecretContext): void => {
  const column = `${context.model}.${context.field}`;
  if (legacyWarned.has(column)) return;
  legacyWarned.add(column);
  logger.warn(
    `${column} still holds an unencrypted value. It is being read as plaintext so ` +
      `nothing breaks, but it stays readable in a database dump until ` +
      `\`npm run secrets:rewrap\` runs.`,
  );
};

/** Test seam — lets a spec assert the warning fires once. */
export function resetLegacyPlaintextWarnings(): void {
  legacyWarned.clear();
}

// ── writes ──────────────────────────────────────────────────────────────────

/**
 * Encrypts the declared fields of one write payload.
 *
 * A field value takes one of two shapes. In a create it is always the value
 * itself; in an update it may instead be `{ set: value }`. Every other Prisma
 * update operator is numeric or list-shaped and meaningless on a string
 * column, so anything that is neither form is left untouched rather than
 * mangled into one.
 */
function encryptPayloadFields(
  model: string,
  payload: AnyRecord,
  fields: readonly string[],
): void {
  for (const field of fields) {
    const value = payload[field];
    if (value === undefined) continue;

    const context: SecretContext = { model, field };

    if (typeof value === 'string' || value === null) {
      payload[field] = encryptSecret(value, context);
      continue;
    }

    if (isRecord(value) && value.set !== undefined) {
      const inner = value.set;
      if (typeof inner === 'string' || inner === null) {
        payload[field] = { ...value, set: encryptSecret(inner, context) };
      }
    }
  }
}

/** Walks a create/update payload: its own encrypted fields, then its relations. */
function encryptWritePayload(model: string, data: unknown): unknown {
  if (Array.isArray(data)) return data.map((entry) => encryptWritePayload(model, entry));
  if (!isRecord(data)) return data;

  const payload: AnyRecord = { ...data };

  const fields = encryptedFieldsOf(model);
  if (fields) encryptPayloadFields(model, payload, fields);

  const relations = relationsOf(model);
  for (const [field, value] of Object.entries(payload)) {
    const relation = relations.get(field);
    if (relation === undefined || !isRecord(value)) continue;
    payload[field] = encryptNestedWrite(relation.target, value);
  }

  return payload;
}

/**
 * The nested-write operators, for a relation whose target may hold secrets.
 *
 * Only the operators carrying a payload are touched. `connect`, `disconnect`,
 * `set` and `delete` carry a `where`, which cannot name an encrypted column —
 * assertNoEncryptedFilter throws before a query gets this far.
 */
function encryptNestedWrite(target: string, nested: AnyRecord): AnyRecord {
  const out: AnyRecord = { ...nested };

  const eachOf = (value: unknown, fn: (entry: AnyRecord) => AnyRecord): unknown => {
    if (Array.isArray(value)) return value.map((entry) => (isRecord(entry) ? fn(entry) : entry));
    return isRecord(value) ? fn(value) : value;
  };

  if (out.create !== undefined) out.create = encryptWritePayload(target, out.create);

  if (isRecord(out.createMany)) {
    out.createMany = {
      ...out.createMany,
      data: encryptWritePayload(target, out.createMany.data),
    };
  }

  if (out.connectOrCreate !== undefined) {
    out.connectOrCreate = eachOf(out.connectOrCreate, (entry) => ({
      ...entry,
      create: encryptWritePayload(target, entry.create),
    }));
  }

  if (out.upsert !== undefined) {
    out.upsert = eachOf(out.upsert, (entry) => ({
      ...entry,
      create: encryptWritePayload(target, entry.create),
      update: encryptWritePayload(target, entry.update),
    }));
  }

  for (const operator of ['update', 'updateMany'] as const) {
    if (out[operator] === undefined) continue;
    out[operator] = eachOf(out[operator], (entry) => {
      // A to-one `update` may be the payload itself rather than {where, data}.
      if (entry.data === undefined) return encryptWritePayload(target, entry) as AnyRecord;
      return { ...entry, data: encryptWritePayload(target, entry.data) };
    });
  }

  return out;
}

// ── refusing to filter on ciphertext ────────────────────────────────────────

const NESTED_FILTER_OPERATORS = ['some', 'every', 'none', 'is', 'isNot'];

/**
 * Throws if a `where` or `orderBy` names an encrypted column.
 *
 * Randomised encryption means such a query silently matches nothing, which
 * reads as an empty result rather than as a mistake. Recurses through
 * `AND`/`OR`/`NOT` and into relation filters, because the wrong idea is just as
 * wrong one level down.
 */
function assertNoEncryptedFilter(model: string, clause: unknown, kind: string): void {
  if (Array.isArray(clause)) {
    for (const entry of clause) assertNoEncryptedFilter(model, entry, kind);
    return;
  }
  if (!isRecord(clause)) return;

  const fields = encryptedFieldsOf(model);
  const relations = relationsOf(model);

  for (const [key, value] of Object.entries(clause)) {
    if (key === 'AND' || key === 'OR' || key === 'NOT') {
      assertNoEncryptedFilter(model, value, kind);
      continue;
    }

    // `{ field: null }` is the exception, and a real query: NULL is stored as
    // NULL, so "which of these has no key set" is answerable and correct. Every
    // other comparison is against ciphertext and cannot be.
    if (fields?.includes(key) && value !== null) {
      throw new Error(
        `Cannot ${kind} by ${model}.${key}: it is encrypted at rest with a random IV, so ` +
          `no comparison against a stored value can match. Look the row up by another ` +
          `column and compare after decryption.`,
      );
    }

    const relation = relations.get(key);
    if (relation === undefined || !isRecord(value)) continue;

    // `some`/`every`/`none` (to-many) and `is`/`isNot` (to-one) wrap the real
    // filter one level down; anything else is already the filter itself.
    for (const [inner, innerValue] of Object.entries(value)) {
      const nested = NESTED_FILTER_OPERATORS.includes(inner)
        ? innerValue
        : { [inner]: innerValue };
      assertNoEncryptedFilter(relation.target, nested, kind);
    }
  }
}

// ── reads ───────────────────────────────────────────────────────────────────

/**
 * Decrypts every declared column in a result, at any depth.
 *
 * Mutates rather than copies: these objects are built by Prisma for this
 * caller and are not shared, and deep-cloning every returned row to rewrite two
 * fields would be a real cost on the reads that touch none.
 *
 * A field absent from the row (excluded by `select`, or NULL) is skipped, and a
 * value that is not a string is left alone — which covers `_count`, aggregates
 * and `groupBy` shapes without this needing to know about them.
 */
function decryptResult(model: string, result: unknown): void {
  if (Array.isArray(result)) {
    for (const entry of result) decryptResult(model, entry);
    return;
  }
  if (!isRecord(result)) return;

  const fields = encryptedFieldsOf(model);
  if (fields) {
    for (const field of fields) {
      const value = result[field];
      if (typeof value !== 'string') continue;
      result[field] = decryptSecret(value, { model, field }, warnLegacy);
    }
  }

  // Driven by the keys the row actually has rather than by every relation the
  // model declares. A `users` row carries a handful of columns and whatever was
  // included; iterating the model's 37 relations to find the one that was would
  // cost more than the decryption does.
  //
  // An earlier version tried to precompute which relations could lead to an
  // encrypted column and walk only those. It bought almost nothing: `tenants`
  // holds encrypted columns and nearly every model reaches it, so 36 of 40
  // models kept their entire relation list. Measured, then removed.
  const relations = relationsOf(model);
  for (const [field, value] of Object.entries(result)) {
    if (value === null || value === undefined) continue;
    const relation = relations.get(field);
    if (relation) decryptResult(relation.target, value);
  }
}

// ── the extension ───────────────────────────────────────────────────────────

const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATE_OPERATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

/**
 * Rewrites one operation's arguments on the way in.
 *
 * Runs for every model, not only the ones holding secrets: a model with no
 * encrypted column of its own can still nest into one in either direction — a
 * `tenants` read including its `tenant_secrets`, a `tenants` create nesting
 * them — and the cheap per-model check happens inside the walk.
 */
function rewriteArguments(model: string, operation: string, args: AnyRecord): AnyRecord {
  const out: AnyRecord = { ...args };

  if (out.where !== undefined) assertNoEncryptedFilter(model, out.where, 'filter');
  if (out.orderBy !== undefined) assertNoEncryptedFilter(model, out.orderBy, 'order');

  // `distinct` and `groupBy`'s `by` are the same mistake as a filter, one step
  // further on: a random IV makes every row's value unique, so both silently
  // return one group per row instead of erroring.
  for (const argument of ['distinct', 'by'] as const) {
    const value = out[argument];
    if (!Array.isArray(value)) continue;

    const fields = encryptedFieldsOf(model);
    const offender = value.find((field) => typeof field === 'string' && fields?.includes(field));
    if (offender !== undefined) {
      throw new Error(
        `Cannot use ${model}.${String(offender)} in \`${argument}\`: it is encrypted with a ` +
          `random IV, so every row is distinct whatever its value.`,
      );
    }
  }

  if (operation === 'upsert') {
    if (out.create !== undefined) out.create = encryptWritePayload(model, out.create);
    if (out.update !== undefined) out.update = encryptWritePayload(model, out.update);
  } else if (
    (CREATE_OPERATIONS.has(operation) || UPDATE_OPERATIONS.has(operation)) &&
    out.data !== undefined
  ) {
    out.data = encryptWritePayload(model, out.data);
  }

  return out;
}

export const secretEncryptionExtension = Prisma.defineExtension({
  name: 'secret-encryption',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const modelName = model ?? '';
        const rewritten = isRecord(args) ? rewriteArguments(modelName, operation, args) : args;

        const result: unknown = await query(rewritten);
        decryptResult(modelName, result);
        return result;
      },
    },
  },
});
