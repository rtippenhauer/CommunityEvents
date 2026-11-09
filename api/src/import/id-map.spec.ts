import { describe, expect, it } from 'vitest';
import { IdMap, IdMapSequencingError } from './id-map';

/**
 * REQ-IMPORT-01's unit testing requirement, which names two behaviours: that
 * remapping a foreign key through an existing map produces the right value, and
 * that importing a table before its target is available "fails loudly rather
 * than writing a bad reference".
 *
 * The second is the whole point of this class, so most of what follows is about
 * the boundary between the two failures it distinguishes — a plan-level
 * sequencing bug, which throws, and an orphaned source row, which does not.
 */
describe('IdMap', () => {
  describe('remapping a foreign key', () => {
    it('resolves a recorded pairing', () => {
      const ids = new IdMap();
      ids.open('users');
      ids.record('users', 7, 412);

      expect(ids.resolve('users', 7, 'events.created_by')).toBe(412);
    });

    it('keeps each table in its own namespace', () => {
      // Source id 1 exists in most tables; the whole reason the maps are keyed
      // by table is that they are unrelated rows.
      const ids = new IdMap();
      ids.open('users');
      ids.open('events');
      ids.record('users', 1, 100);
      ids.record('events', 1, 200);

      expect(ids.resolve('users', 1, 'x')).toBe(100);
      expect(ids.resolve('events', 1, 'x')).toBe(200);
    });

    it('passes null through a nullable key without consulting the map', () => {
      const ids = new IdMap();
      ids.open('cities');

      expect(ids.resolveNullable('cities', null, 'users.city_id')).toEqual({
        value: null,
        orphaned: false,
      });
      expect(ids.resolveNullable('cities', undefined, 'users.city_id')).toEqual({
        value: null,
        orphaned: false,
      });
    });

    it('reports a nullable key whose target was not imported, and writes null', () => {
      // The distinction the summary needs: this is not the same answer as the
      // source row having held NULL, even though both write NULL.
      const ids = new IdMap();
      ids.open('cities');
      ids.record('cities', 1, 50);

      expect(ids.resolveNullable('cities', 9, 'users.city_id')).toEqual({
        value: null,
        orphaned: true,
      });
    });
  });

  describe('a table the plan has not reached', () => {
    it('throws rather than returning undefined', () => {
      // The failure REQ-IMPORT-01 asks to be loud. Returning undefined here
      // would be indistinguishable from an orphan, and the caller's orphan
      // branch writes NULL or skips the row — so a sequencing bug would import
      // as data loss instead of stopping.
      const ids = new IdMap();

      expect(() => ids.resolve('events', 4, 'event_rsvps.event_id')).toThrow(IdMapSequencingError);
    });

    it('names the column and the fix in the message', () => {
      const ids = new IdMap();

      expect(() => ids.resolve('events', 4, 'event_rsvps.event_id')).toThrow(
        /event_rsvps\.event_id needs a events id.*Move events earlier in the table plan/s,
      );
    });

    it('throws on a nullable key too, for a non-null source value', () => {
      const ids = new IdMap();

      expect(() => ids.resolveNullable('invites', 3, 'users.invite_id')).toThrow(
        IdMapSequencingError,
      );
    });

    it('refuses to record into it', () => {
      const ids = new IdMap();

      expect(() => ids.record('users', 1, 2)).toThrow(/before users was opened/);
    });
  });

  describe('an opened but empty table', () => {
    it('reports a missing id as an orphan rather than throwing', () => {
      // An RSVP whose event was hard-deleted. Real v1 data has these and they
      // are not a programming error, so the import must carry on.
      const ids = new IdMap();
      ids.open('events');

      expect(ids.resolve('events', 4, 'event_rsvps.event_id')).toBeUndefined();
    });
  });

  describe('open', () => {
    it('is idempotent and never discards recorded pairs', () => {
      const ids = new IdMap();
      ids.open('users');
      ids.record('users', 1, 10);
      ids.open('users');

      expect(ids.resolve('users', 1, 'x')).toBe(10);
      expect(ids.size('users')).toBe(1);
    });

    it('reports which tables have been reached, in order', () => {
      const ids = new IdMap();
      ids.open('cities');
      ids.open('users');

      expect(ids.isOpen('cities')).toBe(true);
      expect(ids.isOpen('events')).toBe(false);
      expect(ids.openedTables()).toEqual(['cities', 'users']);
    });
  });

  describe('recording the same source row twice', () => {
    it('is refused rather than taking the later id', () => {
      // The shape a re-run against a half-finished target takes. The first
      // mapping is the one every row written since has already pointed at, so
      // replacing it corrupts work already done — which is worse than stopping.
      const ids = new IdMap();
      ids.open('users');
      ids.record('users', 7, 412);

      expect(() => ids.record('users', 7, 999)).toThrow(
        /users#7 is already mapped to #412.*imported twice/s,
      );
    });

    it('tolerates recording the identical pairing again', () => {
      const ids = new IdMap();
      ids.open('users');
      ids.record('users', 7, 412);

      expect(() => ids.record('users', 7, 412)).not.toThrow();
      expect(ids.size('users')).toBe(1);
    });
  });

  describe('size', () => {
    it('counts rows imported per table, and is zero for a table not reached', () => {
      const ids = new IdMap();
      ids.open('users');
      ids.record('users', 1, 10);
      ids.record('users', 2, 11);

      expect(ids.size('users')).toBe(2);
      expect(ids.size('events')).toBe(0);
    });
  });
});
