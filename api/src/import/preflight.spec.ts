import { describe, expect, it } from 'vitest';
import { EXCLUDED_TABLES, TABLE_PLANS } from './plan';
import { expectedSourceColumns } from './plan-types';
import { formatPreflight, preflight, type SourceColumn } from './preflight';
import { V1_SCHEMA } from './v1-schema.fixture';

/** The source database as the plan expects it, for a run with no drift. */
function cleanSource(): SourceColumn[] {
  const rows: SourceColumn[] = [];
  for (const [table, columns] of Object.entries(V1_SCHEMA)) {
    for (const column of columns) rows.push({ table, column });
  }
  return rows;
}

describe('preflight', () => {
  it('passes against v1 as the plan was written', () => {
    const result = preflight(cleanSource());

    expect(result.findings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(formatPreflight(result)).toContain('matches the import plan exactly');
  });

  describe('a column the plan does not account for', () => {
    it('is an error, not a warning', () => {
      // The drift that matters: v1 is deployed and still taking bugfixes, and a
      // column added there would otherwise be dropped in silence.
      const result = preflight([...cleanSource(), { table: 'users', column: 'pronouns' }]);

      expect(result.ok).toBe(false);
      expect(result.findings).toContainEqual({
        severity: 'error',
        message: expect.stringContaining('users.pronouns exists in the source database'),
      });
    });

    it('says what to do about it rather than just reporting it', () => {
      const result = preflight([...cleanSource(), { table: 'events', column: 'dress_code' }]);

      expect(formatPreflight(result)).toMatch(/copy it, remap it, or drop it with a reason/);
    });
  });

  describe('a column the plan reads but the source lacks', () => {
    it('is an error, because the usual cause is a misspelling in the plan', () => {
      const result = preflight(
        cleanSource().filter((c) => !(c.table === 'users' && c.column === 'calendar_token')),
      );

      expect(result.ok).toBe(false);
      expect(formatPreflight(result)).toMatch(
        /users\.calendar_token is in the import plan but not in the source database/,
      );
    });
  });

  describe('a table nobody has classified', () => {
    it('is an error', () => {
      const result = preflight([...cleanSource(), { table: 'bear_hugs', column: 'id' }]);

      expect(result.ok).toBe(false);
      expect(formatPreflight(result)).toMatch(
        /"bear_hugs" is neither in the import plan nor declared as excluded/,
      );
    });
  });

  describe('a planned table missing entirely', () => {
    it('is an error that mentions the wrong-database case', () => {
      const result = preflight(cleanSource().filter((c) => c.table !== 'events'));

      expect(result.ok).toBe(false);
      expect(formatPreflight(result)).toMatch(/connection points at the wrong database/);
    });
  });

  describe('the three tables v1 documents but never created', () => {
    it('passes while they are absent', () => {
      expect(preflight(cleanSource()).ok).toBe(true);
    });

    it('fails if one turns up, because the plan was written on its absence', () => {
      // `invites.guest_rsvp_id` is written as NULL on the finding that no
      // migration ever created `event_guest_rsvps`. If it exists, that finding
      // is out of date and the import needs a decision.
      const result = preflight([
        ...cleanSource(),
        { table: 'event_guest_rsvps', column: 'id' },
        { table: 'event_guest_rsvps', column: 'email' },
      ]);

      expect(result.ok).toBe(false);
      expect(formatPreflight(result)).toMatch(
        /"event_guest_rsvps" exists, and this import was written on the finding that it never did/,
      );
    });
  });

  describe('an excluded table that is absent', () => {
    it('warns without failing, since nothing depends on it', () => {
      const result = preflight(cleanSource().filter((c) => c.table !== 'merch_config'));

      expect(result.ok).toBe(true);
      expect(result.findings).toContainEqual({
        severity: 'warning',
        message: expect.stringContaining('Excluded source table "merch_config" does not exist'),
      });
    });
  });
});

/**
 * The plan's own consistency, independent of any database.
 *
 * These are the invariants the preflight assumes and could not detect: it
 * compares the plan against a source database, so a plan that contradicts
 * itself would be compared faithfully and still be wrong.
 */
describe('the import plan', () => {
  it('classifies every table exactly once', () => {
    const planned = TABLE_PLANS.map((p) => p.source);
    const excluded = EXCLUDED_TABLES.map((e) => e.source);
    const both = planned.filter((t) => excluded.includes(t));

    expect(both).toEqual([]);
    expect(new Set(planned).size).toBe(planned.length);
    expect(new Set(excluded).size).toBe(excluded.length);
  });

  it('covers every table v1 actually has', () => {
    // Derived from v1's TypeORM entities rather than from its schema doc, which
    // describes three tables no migration creates.
    const classified = new Set([
      ...TABLE_PLANS.map((p) => p.source),
      ...EXCLUDED_TABLES.map((e) => e.source),
    ]);
    const unclassified = Object.keys(V1_SCHEMA).filter((t) => !classified.has(t));

    expect(unclassified).toEqual([]);
  });

  it('accounts for every column of every table it reads', () => {
    for (const plan of TABLE_PLANS) {
      const actual = V1_SCHEMA[plan.source];
      expect(actual, `${plan.source} is in the plan but not in the v1 schema fixture`).toBeDefined();
      expect(expectedSourceColumns(plan).sort(), `${plan.source} column rules`).toEqual(
        [...actual].sort(),
      );
    }
  });

  it('orders every table after the tables it remaps through', () => {
    // The ordering invariant `IdMap` enforces at runtime, checked statically so
    // a reordering is caught by the suite rather than by a half-finished import.
    //
    // The two dependency cycles are closed by backfill passes, so the columns
    // that form them are declared `custom` rather than `fk` and do not appear
    // here — which is exactly why they had to be deferred.
    const reached = new Set<string>();

    for (const plan of TABLE_PLANS) {
      for (const [column, rule] of Object.entries(plan.columns)) {
        if (rule.kind !== 'fk') continue;
        // A self-reference resolves within the table, by ascending id.
        if (rule.table === plan.model || rule.table === plan.source) continue;
        expect(
          reached.has(rule.table),
          `${plan.source}.${column} remaps through "${rule.table}", which the plan reaches later`,
        ).toBe(true);
      }
      for (const name of plan.idMapNames ?? [plan.model]) {
        if (name) reached.add(name);
      }
      reached.add(plan.source);
    }
  });

  it('gives every dropped column a reason worth reading', () => {
    for (const plan of TABLE_PLANS) {
      for (const [column, rule] of Object.entries(plan.columns)) {
        if (rule.kind !== 'drop' && rule.kind !== 'custom') continue;
        expect(rule.reason.length, `${plan.source}.${column}`).toBeGreaterThan(20);
      }
    }
  });

  it('gives every excluded table a reason worth reading', () => {
    for (const entry of EXCLUDED_TABLES) {
      expect(entry.reason.length, entry.source).toBeGreaterThan(20);
    }
  });
});
