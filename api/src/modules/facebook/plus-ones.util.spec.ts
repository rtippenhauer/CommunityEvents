import { describe, expect, it } from 'vitest';
import {
  mergePlusOnes,
  toSource,
  unnamedIn,
  withoutWebsiteGuests,
  type PlusOneSource,
} from './plus-ones.util';

/**
 * Rule 9 and rule 10 of the Facebook sync (v2-29).
 *
 * Tested directly rather than only through the sync because these two rules
 * decide a number that gets written into a Facebook event description and used
 * to book a table. The failure mode is a plausible-looking count, which is
 * exactly the kind that survives an end-to-end test where the arithmetic
 * happens to come out the same.
 */
describe('Facebook +1 merging (v2-29)', () => {
  const source = (names: string[], total?: number): PlusOneSource =>
    toSource(names, total ?? names.length);

  describe('one list', () => {
    it('counts names plus the unnamed remainder', () => {
      expect(mergePlusOnes([source(['Pat Lee'], 3)])).toEqual({
        names: ['Pat Lee'],
        total: 3,
      });
    });

    it('treats a repeated name as separate people', () => {
      // Two "Guest" entries are two humans, which is why this works on
      // multisets. A set would silently lose a seat.
      expect(mergePlusOnes([source(['Guest', 'Guest'])])).toEqual({
        names: ['Guest', 'Guest'],
        total: 2,
      });
    });

    it('accepts a bare count with no names at all', () => {
      // The "+2" comment, which is why `plus_ones` can be sent on its own.
      expect(mergePlusOnes([source([], 2)])).toEqual({ names: [], total: 2 });
    });

    it('does not correct a total that is lower than the names given', () => {
      // Somebody who wrote "+1" and then named two people is bringing two.
      expect(mergePlusOnes([source(['Pat', 'Sam'], 1)])).toEqual({
        names: ['Pat', 'Sam'],
        total: 2,
      });
      expect(unnamedIn(source(['Pat', 'Sam'], 1))).toBe(0);
    });

    it('drops blank names rather than inventing anonymous people', () => {
      // An empty string is a comment-parsing artefact. Kept, it would both
      // invent a person called "" and consume an unnamed slot.
      const merged = mergePlusOnes([toSource(['Pat', '', '   ', null], 3)]);
      expect(merged.names).toEqual(['Pat']);
      expect(merged.total).toBe(3);
    });
  });

  describe('across several lists', () => {
    it('takes the largest single observation, never the sum', () => {
      // The worked example from the util's header.
      const merged = mergePlusOnes([
        source(['Pat', 'Pat', 'Sam'], 4),
        source(['Pat', 'Dale'], 5),
      ]);

      // Pat twice (not three times), Sam, Dale, and 3 unnamed -- the larger
      // single list's unnamed count, not 1 + 3.
      expect(merged.names).toEqual(['Dale', 'Pat', 'Pat', 'Sam']);
      expect(merged.total).toBe(7);
    });

    it('counts a person on two lists once', () => {
      // The core of rule 9: a dinner with two Facebook events must not
      // double-count anybody at a real table.
      expect(mergePlusOnes([source(['Pat']), source(['Pat'])])).toEqual({
        names: ['Pat'],
        total: 1,
      });
    });

    it('takes the largest unnamed count rather than adding them up', () => {
      expect(mergePlusOnes([source([], 2), source([], 3)])).toEqual({
        names: [],
        total: 3,
      });
    });

    it('treats differently-cased spellings as one person, keeping the first', () => {
      const merged = mergePlusOnes([source(['Pat Lee']), source(['pat lee'])]);
      expect(merged.names).toEqual(['Pat Lee']);
      expect(merged.total).toBe(1);
    });

    it('is order-independent', () => {
      const a = mergePlusOnes([source(['Pat', 'Pat'], 3), source(['Sam'], 1)]);
      const b = mergePlusOnes([source(['Sam'], 1), source(['Pat', 'Pat'], 3)]);
      expect(a).toEqual(b);
    });

    it('is empty for a person with no +1s anywhere', () => {
      expect(mergePlusOnes([source([]), source([])])).toEqual({ names: [], total: 0 });
      expect(mergePlusOnes([])).toEqual({ names: [], total: 0 });
    });

    it('sorts names, so an unchanged list compares equal after a re-read', () => {
      // What makes "did this member's +1s change" answerable without a false
      // positive every time Facebook returns the comments in another order.
      const first = mergePlusOnes([source(['Sam', 'Dale', 'Pat'])]);
      const second = mergePlusOnes([source(['Pat', 'Sam', 'Dale'])]);
      expect(first).toEqual(second);
    });
  });

  describe('website guests already accounted for (rule 10)', () => {
    it('skips a Facebook +1 with the same name as a named website guest', () => {
      const merged = mergePlusOnes([source(['Pat Lee', 'Sam Fox'])]);
      expect(withoutWebsiteGuests(merged, ['Pat Lee'])).toEqual({
        names: ['Sam Fox'],
        total: 1,
      });
    });

    it('matches case-insensitively', () => {
      const merged = mergePlusOnes([source(['pat lee'])]);
      expect(withoutWebsiteGuests(merged, ['Pat Lee'])).toEqual({ names: [], total: 0 });
    });

    it('covers exactly one +1 per website guest', () => {
      // Two Pat Lees in the comments and one on the website is two people:
      // one is the website guest, the other a genuine extra.
      const merged = mergePlusOnes([source(['Pat Lee', 'Pat Lee'])]);
      expect(withoutWebsiteGuests(merged, ['Pat Lee'])).toEqual({
        names: ['Pat Lee'],
        total: 1,
      });
    });

    it('lets an unnamed website guest absorb nobody', () => {
      // "+2" on the site and "+2" in the comments is ambiguous, and the rule
      // errs toward counting both: an over-count is visible at the table and
      // an under-count is not.
      const merged = mergePlusOnes([source([], 2)]);
      expect(withoutWebsiteGuests(merged, [null, null])).toEqual({
        names: [],
        total: 2,
      });
    });

    it('leaves unnamed Facebook +1s untouched while skipping a named one', () => {
      const merged = mergePlusOnes([source(['Pat Lee'], 3)]);
      // Pat is covered; the two unnamed are not.
      expect(withoutWebsiteGuests(merged, ['Pat Lee'])).toEqual({
        names: [],
        total: 2,
      });
    });

    it('is a no-op when the member added no website guests', () => {
      const merged = mergePlusOnes([source(['Pat Lee'], 2)]);
      expect(withoutWebsiteGuests(merged, [])).toEqual(merged);
      expect(withoutWebsiteGuests(merged, null)).toEqual(merged);
    });
  });
});
