/**
 * When the provider's sending day starts and ends.
 *
 * The daily counters exist for one reason: to keep a community under its
 * provider's daily allowance. That only works if our day and the provider's day
 * are the same day — and they were not. This code compared calendar days in
 * **UTC**, while a Brevo account's allowance resets on the account's own
 * schedule, which for a US operator is hours earlier or later. Found on stage:
 * two invites sent four hours apart landed either side of UTC midnight, so the
 * screen read `1 / 300` on both communities while Brevo's dashboard had counted
 * all four messages of the evening against one allowance.
 *
 * The failure that matters is not the confusing screen. It is that between our
 * rollover and the provider's, the deployment believes it has a fresh 300 sends
 * while the provider is still counting toward the old limit — so the guard can
 * wave through exactly the overage it was put there to prevent.
 *
 * `EMAIL_QUOTA_TIMEZONE` names the zone the provider account resets in. It
 * defaults to UTC, which is the old behaviour, so an install that sets nothing
 * is unchanged.
 *
 * This is a deployment setting rather than a per-community one on purpose: it
 * describes the operator's provider accounts, and every community on a
 * deployment is administered by the same operator. A community that wanted a
 * different one would be describing a different provider account's billing
 * schedule, which is not something its admin knows.
 */

/** What the counters used before the setting existed, and the fallback. */
export const DEFAULT_QUOTA_TIME_ZONE = 'UTC';

/**
 * The configured zone, or UTC if it is missing or not a zone this runtime
 * knows.
 *
 * Falls back rather than throwing. A mistyped zone name should not stop a
 * deployment from sending mail — the counters simply keep the behaviour they
 * had before the setting existed, which is safe, and the caller logs it.
 */
export function resolveQuotaTimeZone(raw: string | undefined | null): {
  timeZone: string;
  invalid?: string;
} {
  const candidate = raw?.trim();
  if (!candidate) return { timeZone: DEFAULT_QUOTA_TIME_ZONE };
  try {
    // Throws RangeError on anything that is not an IANA zone this ICU build
    // carries. Note a container built without full ICU knows only UTC, which is
    // why this is checked at all rather than trusted.
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return { timeZone: candidate };
  } catch {
    return { timeZone: DEFAULT_QUOTA_TIME_ZONE, invalid: candidate };
  }
}

/**
 * The instant at which the quota day containing `instant` began.
 *
 * Returned as an instant rather than a calendar day so it can be compared in
 * SQL — `last_reset_date < quotaDayStart(...)` is the whole day-rollover test,
 * evaluated by the database, which is what lets the immediate-send path reset
 * the counters without a read-modify-write race against the dispatcher.
 */
export function quotaDayStart(instant: Date, timeZone: string): Date {
  const offset = zonedOffsetMs(instant, timeZone);

  // Shift into the zone's wall clock, then read the date off it. Reading via
  // getUTC* is deliberate: the shifted value is wall-clock-as-if-UTC, and the
  // process's own local zone must not enter into this anywhere.
  const wall = new Date(instant.getTime() + offset);
  const midnightWall = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());

  // Two passes, because the offset at midnight is not always the offset now:
  // on a DST changeover day the two differ by an hour, and using the wrong one
  // puts the boundary an hour out for exactly the 24 hours nobody is watching.
  const firstGuess = midnightWall - offset;
  const offsetAtMidnight = zonedOffsetMs(new Date(firstGuess), timeZone);
  return new Date(offsetAtMidnight === offset ? firstGuess : midnightWall - offsetAtMidnight);
}

/** How far ahead of UTC `timeZone` is at `instant`, in milliseconds. */
function zonedOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    // h23, not `hour12: false` — the latter renders midnight as hour 24 in some
    // ICU versions, which reads back as the next day.
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const at = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  const asIfUtc = Date.UTC(
    at('year'),
    at('month') - 1,
    at('day'),
    at('hour'),
    at('minute'),
    at('second'),
  );
  // Millisecond truncation is fine and cancels out: both sides of every
  // comparison are built the same way, and a quota day boundary is a whole
  // second wide at worst.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}
