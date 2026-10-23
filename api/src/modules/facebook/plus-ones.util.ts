/**
 * Merging one person's Facebook +1s across several Going lists (v2-29, rule 9).
 *
 * Pure and DOM-free, like `palette.ts` in the frontend, and for the same
 * reason: this is the one piece of the sync whose rules cannot be checked by
 * reading them. It decides headcounts that get written into a Facebook event
 * description, so it is exercised directly by its own spec rather than only
 * through the sync.
 *
 * ## What a list says about one person
 *
 * Muse sends, per guest, `plus_one_names` (names pulled out of the Facebook
 * comments) and `plus_ones` (the total the comment claimed, e.g. "+2" with no
 * names). So one list contributes:
 *
 *   names, plus `max(0, plus_ones - names.length)` unnamed people
 *
 * `plus_ones` below `names.length` is not an error and is not corrected
 * upwards: somebody who wrote "+1" and then named two people has named two
 * people. Taking the max of the two is what the subtraction above does.
 *
 * **Repeated names are separate people.** Two `"Guest"` entries in one list are
 * two humans, not one recorded twice -- which is why this works on multisets
 * and not on sets.
 *
 * ## Merging across lists is MAX, never SUM
 *
 * A dinner can have several Facebook events (one per group), and one person can
 * be Going on more than one of them -- and a linked member can have two Facebook
 * accounts, both appearing. The same +1 then shows up repeatedly, so summing
 * double-counts a real person at a real table.
 *
 * So each name is taken **as many times as the list that repeats it most**, and
 * the unnamed count is the **largest single list's**, never a total:
 *
 *   Cincinnati list: ["Pat", "Pat", "Sam"], 1 unnamed
 *   Gem City list:   ["Pat", "Dale"],       3 unnamed
 *   merged:          Pat x2, Sam, Dale,     3 unnamed  -> 7 people
 *
 * Pat is 2 rather than 3, because one list saw two Pats and the other saw one
 * -- most likely the same two people, one list having missed one. Erring toward
 * the larger single observation rather than the sum is the choice that cannot
 * inflate a restaurant booking.
 */

/** One Facebook event's record of one person's +1s. */
export interface PlusOneSource {
  /** Names read from the comments. May repeat; order is not meaningful. */
  names: string[];
  /** Total +1s the comment claimed, named and unnamed together. */
  total: number;
}

export interface MergedPlusOnes {
  /**
   * The named +1s, with repeats preserved -- two people called "Guest" appear
   * twice. Sorted so a stored value is stable and two equal merges compare
   * equal, which is what makes "did the +1s change" answerable without
   * false positives from reordering.
   */
  names: string[];
  /** Named plus unnamed. What a headcount adds. */
  total: number;
}

/** The unnamed +1s a single list implies. Never negative -- see the header. */
export function unnamedIn(source: PlusOneSource): number {
  return Math.max(0, source.total - source.names.length);
}

/**
 * Normalises one guest's raw `plus_one_names` / `plus_ones` into a source.
 *
 * Blank and whitespace-only names are dropped rather than kept as anonymous
 * people: an empty string in the array is a parsing artefact of the comment,
 * where a genuinely unnamed +1 is expressed by `plus_ones` exceeding the names.
 * Keeping it would both invent a person called "" and consume one of the
 * unnamed slots.
 */
export function toSource(
  plusOneNames: readonly (string | null | undefined)[] | null | undefined,
  plusOnes: number | null | undefined,
): PlusOneSource {
  const names = (plusOneNames ?? [])
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter((name) => name.length > 0);

  return { names, total: Math.max(names.length, plusOnes ?? 0) };
}

/**
 * Merges one person's +1s across every list they appear on.
 *
 * Case-insensitive when deciding whether two names are the same person, but it
 * keeps the first spelling it saw -- "pat lee" and "Pat Lee" are one person, and
 * the display should be the one a human would recognise rather than whichever
 * list happened to come last.
 */
export function mergePlusOnes(sources: readonly PlusOneSource[]): MergedPlusOnes {
  // Per name: the most times any single list repeated it, and the spelling to
  // display it with.
  const maxPerName = new Map<string, { count: number; display: string }>();
  let maxUnnamed = 0;

  for (const source of sources) {
    const countsInThisList = new Map<string, { count: number; display: string }>();

    for (const name of source.names) {
      const key = name.toLowerCase();
      const seen = countsInThisList.get(key);
      countsInThisList.set(key, {
        count: (seen?.count ?? 0) + 1,
        display: seen?.display ?? name,
      });
    }

    for (const [key, here] of countsInThisList) {
      const best = maxPerName.get(key);
      if (best === undefined || here.count > best.count) {
        maxPerName.set(key, { count: here.count, display: best?.display ?? here.display });
      }
    }

    maxUnnamed = Math.max(maxUnnamed, unnamedIn(source));
  }

  const names: string[] = [];
  for (const { count, display } of maxPerName.values()) {
    for (let i = 0; i < count; i += 1) names.push(display);
  }

  // Sorted for a stable stored value -- see `names` on MergedPlusOnes.
  names.sort((a, b) => a.localeCompare(b));

  return { names, total: names.length + maxUnnamed };
}

/**
 * Drops the Facebook +1s that a member's own website guests already account for
 * (rule 10).
 *
 * **Each named website guest covers exactly one Facebook +1 of that name**, and
 * nothing else is absorbed. Two subtleties, both deliberate:
 *
 *  - Matching is on the name, case-insensitively, and one-for-one. A member who
 *    added "Pat Lee" on the site and whose comment names two Pat Lees is
 *    bringing two: one is the website guest, the other is a genuine extra.
 *  - **Unnamed website guests absorb nobody.** "+2" on the website and "+2" in
 *    the comments is the ambiguous case, and resolving it either way is a guess;
 *    the rule errs toward counting both rather than silently losing two seats,
 *    since an over-count is visible at the table and an under-count is not.
 *
 * The unnamed Facebook +1s are left untouched for the same reason.
 */
export function withoutWebsiteGuests(
  merged: MergedPlusOnes,
  websiteGuestNames: readonly (string | null | undefined)[] | null | undefined,
): MergedPlusOnes {
  const remaining = new Map<string, number>();
  for (const name of websiteGuestNames ?? []) {
    if (typeof name !== 'string') continue;
    const key = name.trim().toLowerCase();
    if (key.length === 0) continue;
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const unnamed = merged.total - merged.names.length;
  const kept: string[] = [];

  for (const name of merged.names) {
    const key = name.toLowerCase();
    const covered = remaining.get(key) ?? 0;
    if (covered > 0) {
      remaining.set(key, covered - 1);
      continue;
    }
    kept.push(name);
  }

  return { names: kept, total: kept.length + unnamed };
}
