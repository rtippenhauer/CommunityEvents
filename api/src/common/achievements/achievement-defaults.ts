import * as fs from 'node:fs';
import * as path from 'node:path';
import { $Enums } from '@prisma/client';

/**
 * The achievement catalogue a community starts with (v2-10).
 *
 * This used to be global reference data seeded once by `seed.ts`, which meant
 * every community shared one catalogue and that catalogue held DinnerBears'
 * copy -- "Founding Bear", "Attended 5 DinnerBears dinners" -- with no way for
 * anyone else to override it, because the rows were not theirs. `achievements`
 * is tenant-scoped now, so each community owns and can edit its own set, and
 * DinnerBears' wording becomes that community's data when it migrates.
 *
 * `key` is deliberately NOT templated. Code joins on it -- `founding_member` in
 * `adminBackfillFounders` and `merch.service`, `patriotic_2026` in the splash
 * component -- so it is an identifier, not copy. Only the display fields differ
 * between communities.
 *
 * **No placeholder names the community.** A badge is only ever read inside the
 * community that granted it, so naming it in the copy is redundant -- and it is
 * the one value seeding cannot resolve, because neither `bootstrap.ts` nor
 * `tenants-admin.service.create` has written a `brand_name` by the time the
 * catalogue is seeded. Substituting it would have baked the platform default
 * into 50 rows that then never update when the community picks its real name.
 *
 * **Terminology is filled at seed time, unlike the legal defaults which fill at
 * read time.** That difference is deliberate. `fillLegalPlaceholders`
 * exists because renaming a community must not strand its old name inside two
 * legal documents, and those have exactly two read paths to cover. The
 * catalogue has seven across three services (list, admin list, by-key lookups,
 * points, custom icons, the splash payload), and a missed one would show a
 * member a literal `{{dinner_plural_lower}}`. Since scoping made these rows
 * editable data by design, a community that renames its terms afterwards can
 * fix the wording in Admin -> Achievements -- which it could not do when the
 * catalogue was global.
 *
 * Note that both callers seed with the *default* terminology today, because
 * neither has configured terms at that point (bootstrap deliberately deletes
 * the seeded terminology rows so a fresh install falls back to the generic
 * defaults). The substitution is here so that a caller which does know the
 * community's terms -- the setup wizard in v2-15 -- gets the right copy without
 * this module changing.
 */

export interface AchievementSeedTerms {
  /** `term_dinner_singular`, lower-cased mid-sentence ("your first dinner"). */
  dinnerSingularLower: string;
  /** `term_dinner_plural`, lower-cased mid-sentence ("attended 5 dinners"). */
  dinnerPluralLower: string;
}

export interface AchievementSeedRow {
  key: string;
  name: string;
  description: string;
  icon: string;
  imagePath: string | null;
  progressType: $Enums.achievements_progress_type | null;
  progressTarget: number | null;
  eventId: number | null;
  points: number;
  title: string | null;
  isSecret: boolean;
}

/**
 * Read at runtime rather than `import`ed, matching `seed.ts`. The path resolves
 * identically from `src/common/achievements` under ts-node and from
 * `dist/common/achievements` in the image, because dist mirrors src -- three
 * levels up lands on `api/` either way.
 */
function loadCatalogue(): AchievementSeedRow[] {
  const file = path.join(__dirname, '..', '..', '..', 'prisma', 'seed-data', 'achievements.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as AchievementSeedRow[];
}

function fill(value: string, terms: AchievementSeedTerms): string {
  return value
    .replace(/\{\{dinner_singular_lower\}\}/g, terms.dinnerSingularLower)
    .replace(/\{\{dinner_plural_lower\}\}/g, terms.dinnerPluralLower);
}

/**
 * The catalogue rows for one community, with its own name and terminology
 * substituted in. Callers add `tenantId` and hand the result to `createMany`.
 *
 * `createdAt` is not returned: a community's catalogue is created when the
 * community is, so the column's `now()` default is the truthful value. The
 * seed data used to carry a fixed 2026-08-09 timestamp from the original
 * export, which would have been wrong for every community created since.
 */
export function achievementDefaultRows(terms: AchievementSeedTerms): AchievementSeedRow[] {
  return loadCatalogue().map((row) => ({
    ...row,
    name: fill(row.name, terms),
    description: fill(row.description, terms),
    title: row.title === null ? null : fill(row.title, terms),
  }));
}
