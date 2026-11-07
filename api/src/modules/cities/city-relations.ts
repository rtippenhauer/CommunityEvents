/**
 * Every table that points at a city, and what happens to its rows when that
 * city is retired (v2-24).
 *
 * **The set of tables is derived from the Prisma DMMF, not written down here.**
 * Deactivating a city moves rows off it, and a hand-written list of which rows
 * is a list that goes stale silently: the next model to gain a `city_id` would
 * simply be missed, its rows left pointing at a city no picker offers. The
 * derivation plus the exhaustiveness check below is the same bargain
 * `tenant-scoped-models.ts` makes -- a new model must be classified or the
 * thing refuses to start.
 *
 * It refuses at **boot** rather than at the first deactivation, because a
 * deactivation is rare and an operator discovering the gap by running one has
 * already left rows behind.
 */
import { Prisma } from '@prisma/client';

/**
 * What a retirement does to rows on the city being retired.
 *
 * The split is not about convenience, it is about whether the row describes
 * something that *happened* or something that *is*:
 *
 *  - `move-future` -- forward-looking rows move to an active city; rows in the
 *    past keep the retired one. **A dinner that happened in Indiana happened in
 *    Indiana**, and a community that stops meeting there should not
 *    retroactively have met in Cincinnati. That is the whole reason deletion is
 *    the wrong verb for a city (Rob, 2026-10-18), and it matches v2-33's #41
 *    one layer over, where a past event keeps the location name it had rather
 *    than following a rename.
 *  - `move-all` -- the row is a live thing with no date to judge it by. A
 *    member and a venue are both *currently* somewhere.
 *  - `keep` -- a historical or short-lived record, nullable already, that
 *    nothing reads a city off in a way a retired value breaks.
 *  - `drop` -- a member's stated preference. Leaving it would keep somebody
 *    subscribed to a city no screen can show them, which reads as a filter
 *    silently losing events.
 */
export type CityReferencePolicy = 'move-future' | 'move-all' | 'keep' | 'drop';

export interface CityReference {
  readonly policy: CityReferencePolicy;
  /** Shown to the admin on the "this is what I am about to move" summary. */
  readonly label: string;
  /**
   * The column that decides past from future. Required by `move-future` and
   * meaningless otherwise, which the assertion below enforces.
   */
  readonly dateField?: string;
}

/**
 * Keyed by Prisma model name. Every model the DMMF says has a `cityId` must
 * appear exactly once, and nothing else may.
 */
export const CITY_REFERENCES: Readonly<Record<string, CityReference>> = {
  events: { policy: 'move-future', label: 'upcoming events', dateField: 'eventDate' },
  locations: { policy: 'move-all', label: 'locations' },
  users: { policy: 'move-all', label: 'members' },
  /**
   * An announcement is a thing that was said, on a date, to the city it named.
   * Its `city_id` was nullable long before this item and the read path treats
   * a missing one as "everybody", so a retired city here costs nothing.
   */
  announcements: { policy: 'keep', label: 'announcements' },
  /**
   * An invite expires. Moving one would change which city a half-finished
   * registration lands in, after the link was sent and for no reason the
   * recipient could see.
   */
  invites: { policy: 'keep', label: 'invites' },
  user_city_preferences: { policy: 'drop', label: 'member city preferences' },
};

/** The `cityId`-carrying models, read off the generated schema. */
export const CITY_REFERENCING_MODELS: readonly string[] = Prisma.dmmf.datamodel.models
  .filter((model) => model.fields.some((field) => field.name === 'cityId'))
  .map((model) => model.name)
  .sort();

/**
 * Fails at import time -- so at boot -- if the DMMF and the policy map have
 * drifted apart in either direction.
 *
 * Both directions matter. A model in the DMMF and not here is the silent gap
 * this file exists to close. A model here and not in the DMMF is a policy for a
 * column somebody already removed, which reads as coverage and is not.
 */
function assertEveryCityReferenceClassified(): void {
  const declared = Object.keys(CITY_REFERENCES).sort();
  const missing = CITY_REFERENCING_MODELS.filter((m) => !(m in CITY_REFERENCES));
  const extra = declared.filter((m) => !CITY_REFERENCING_MODELS.includes(m));
  if (missing.length || extra.length) {
    throw new Error(
      'city-relations.ts is out of date with schema.prisma. ' +
        (missing.length ? `Models with city_id and no policy: ${missing.join(', ')}. ` : '') +
        (extra.length ? `Policies for models with no city_id: ${extra.join(', ')}.` : ''),
    );
  }

  for (const [model, ref] of Object.entries(CITY_REFERENCES)) {
    const needsDate = ref.policy === 'move-future';
    if (needsDate && !ref.dateField) {
      throw new Error(`city-relations.ts: '${model}' is move-future and names no dateField.`);
    }
    if (!needsDate && ref.dateField) {
      throw new Error(`city-relations.ts: '${model}' names a dateField its policy never reads.`);
    }
  }
}

assertEveryCityReferenceClassified();

/** The models a retirement actually touches, in the order it touches them. */
export const CITY_RETIREMENT_MODELS: readonly string[] = CITY_REFERENCING_MODELS.filter(
  (model) => CITY_REFERENCES[model].policy !== 'keep',
);
