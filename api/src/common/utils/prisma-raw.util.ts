/**
 * Normalises the rows a `$queryRaw`/`$queryRawUnsafe` hands back.
 *
 * The MySQL driver under `@prisma/adapter-mariadb` decodes every integer
 * column of a raw result as a JavaScript `bigint` -- `SELECT 1` comes back as
 * `1n`, and so does `users.id`. Prisma's own typed queries are unaffected,
 * because the query engine converts them using the schema; a raw query has no
 * schema to convert against, so whatever the driver produced is what the
 * caller gets, regardless of the `<{ id: number }[]>` type argument written at
 * the call site. The driver's own `bigIntAsNumber` option does not help: the
 * adapter sets its decoding options per query and overrides the pool's.
 *
 * A bigint that escapes a raw query breaks two things, neither of them at the
 * call site:
 *
 *   - feeding it back into Prisma throws
 *     "Argument `in`: Invalid value provided. Expected Int, provided BigInt"
 *   - returning it from a controller throws
 *     "Do not know how to serialize a BigInt" inside JSON.stringify
 *
 * Both surface as a 500 far from the query that caused them, which is how the
 * leaderboard and member-list endpoints were broken by the TypeORM->Prisma
 * swap without anything failing at build time.
 *
 * Every raw query in the codebase that selects a numeric column should pass
 * its rows through here. Values above Number.MAX_SAFE_INTEGER throw rather
 * than silently losing precision -- no column in this schema is wide enough to
 * reach that, so it firing means something is genuinely wrong.
 */
export function coerceRawRow<T extends object>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === 'bigint' ? bigintToNumber(key, value) : value;
  }
  return out as T;
}

export function coerceRawRows<T extends object>(rows: T[]): T[] {
  return rows.map((row) => coerceRawRow(row));
}

function bigintToNumber(key: string, value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`Raw query column "${key}" is outside the safe integer range: ${value}`);
  }
  return Number(value);
}
