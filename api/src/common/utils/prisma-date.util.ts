/**
 * Converts Prisma's Date objects back to the string forms the codebase works
 * in for DATE and TIME columns.
 *
 * The TypeORM entities typed `event_date` as `string` ('2026-08-09') and
 * `event_time` as `string` ('18:30:00'), because the driver handed those
 * column types back as strings. Prisma types both as DateTime and returns
 * Date objects, so every piece of logic downstream — RSVP cutoffs, calendar
 * export, event grouping — would otherwise be comparing or formatting the
 * wrong kind of value.
 *
 * A TIME column comes back as a Date on 1970-01-01 carrying only the clock
 * portion, so both helpers read UTC parts: using local getters would shift the
 * value by the host's offset and silently move an event by hours.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/** DATE column -> 'YYYY-MM-DD'. */
export function toDateString(value: Date): string {
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}

/** TIME column -> 'HH:MM:SS'. */
export function toTimeString(value: Date): string {
  return `${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}`;
}
