import { coerceRawRow, coerceRawRows } from './prisma-raw.util';

/**
 * Written during v2-2 to fix three production 500s and, until now, untested in
 * isolation — the defect it exists to prevent had already shipped once.
 *
 * The MySQL driver under @prisma/adapter-mariadb decodes every integer column
 * of a raw query as a bigint. A bigint that escapes breaks either inside Prisma
 * ("Expected Int, provided BigInt") or inside JSON.stringify ("Do not know how
 * to serialize a BigInt"), always somewhere other than the query that produced
 * it.
 */
describe('coerceRawRow', () => {
  it('converts bigint values to numbers', () => {
    const out = coerceRawRow({ id: 3n, userId: 42n });
    expect(out).toEqual({ id: 3, userId: 42 });
    expect(typeof out.id).toBe('number');
  });

  it('leaves non-bigint values exactly as they are', () => {
    const createdAt = new Date('2026-08-11T00:00:00Z');
    const out = coerceRawRow({
      id: 1n,
      fullName: 'Ada',
      profilePhotoPath: null,
      isNew: true,
      totalPoints: '42',
      createdAt,
    });
    expect(out.fullName).toBe('Ada');
    expect(out.profilePhotoPath).toBeNull();
    expect(out.isNew).toBe(true);
    // A DECIMAL sum arrives as a string; converting it here would be wrong.
    expect(out.totalPoints).toBe('42');
    expect(out.createdAt).toBe(createdAt);
  });

  it('handles zero and negative values', () => {
    expect(coerceRawRow({ a: 0n, b: -7n })).toEqual({ a: 0, b: -7 });
  });

  it('produces a row that JSON.stringify accepts', () => {
    // The precise failure mode on GET /users/members: an unconverted row threw
    // inside the serializer, after the handler had already returned.
    expect(() => JSON.stringify(coerceRawRow({ id: 1n }))).not.toThrow();
    expect(() => JSON.stringify({ id: 1n })).toThrow();
  });

  it('throws rather than silently losing precision above MAX_SAFE_INTEGER', () => {
    const tooBig = BigInt(Number.MAX_SAFE_INTEGER) + 10n;
    expect(() => coerceRawRow({ id: tooBig })).toThrow(/safe integer range/);
  });

  it('names the offending column in that error', () => {
    // A bare "outside the safe integer range" would send someone hunting.
    expect(() => coerceRawRow({ hugeCount: BigInt(Number.MAX_SAFE_INTEGER) + 1n })).toThrow(
      /hugeCount/,
    );
  });

  it('accepts the exact MAX_SAFE_INTEGER boundary', () => {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    expect(coerceRawRow({ id: max })).toEqual({ id: Number.MAX_SAFE_INTEGER });
  });
});

describe('coerceRawRows', () => {
  it('converts every row in the array', () => {
    expect(coerceRawRows([{ id: 1n }, { id: 2n }, { id: 3n }])).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
  });

  it('returns an empty array unchanged', () => {
    expect(coerceRawRows([])).toEqual([]);
  });

  it('yields ids that Prisma will accept in an `in` filter', () => {
    // getLeaderboard fed these straight back into a groupBy and threw
    // "Argument `in`: Invalid value provided. Expected Int, provided BigInt".
    const ids = coerceRawRows([{ userId: 3n }, { userId: 2n }]).map((r) => r.userId);
    expect(ids.every((id) => typeof id === 'number')).toBe(true);
  });
});
