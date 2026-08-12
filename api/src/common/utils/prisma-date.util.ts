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

/**
 * Tolerant variants used where a value may arrive from either ORM.
 *
 * While the Prisma swap is partly done, some services are fed events by their
 * own Prisma queries (Date) and by services still on TypeORM (string). These
 * accept either and always produce the string form, so a caller does not have
 * to know which side it came from. They can be dropped once the last TypeORM
 * service is converted.
 */
export function asDateString(value: Date | string): string {
  return typeof value === 'string' ? value : toDateString(value);
}

export function asTimeString(value: Date | string): string {
  return typeof value === 'string' ? value : toTimeString(value);
}

/**
 * The write direction: DTOs and query params carry 'YYYY-MM-DD' and 'HH:MM'
 * or 'HH:MM:SS' strings, and Prisma wants Date objects for DATE and TIME
 * columns.
 *
 * Both anchor to UTC so they round-trip through toDateString/toTimeString
 * unchanged. A TIME is stored on 1970-01-01, which is how the driver hands it
 * back. Parsing without the trailing Z would apply the host's offset and shift
 * the stored value on any machine that is not on UTC.
 */
export function toDateColumn(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function toTimeColumn(value: string): Date {
  // Accept 'HH:MM' as well as 'HH:MM:SS' -- the event form submits the former.
  const withSeconds = value.length === 5 ? `${value}:00` : value;
  return new Date(`1970-01-01T${withSeconds}Z`);
}

/**
 * The wire format for an event row.
 *
 * `events.event_date` (DATE) and `events.event_time` (TIME) are the only two
 * columns in the schema that the API has always published as plain strings --
 * 'YYYY-MM-DD' and 'HH:MM:SS' -- because that is what the TypeORM entities
 * typed them as and what the frontend still parses. Prisma types both as
 * DateTime and hands back Date objects, so returning a row untouched puts full
 * ISO timestamps on the wire instead: "2026-08-11T00:00:00.000Z" and
 * "1970-01-01T18:30:00.000Z".
 *
 * That breaks the client twice over. `eventTime.substring(0, 5)` yields
 * "1970-", and a DATE read as UTC midnight renders as the *previous day* in
 * any negative-offset timezone -- a Tuesday event shows up as Monday in
 * Eastern.
 *
 * Applied at the controller boundary, not inside the service: findOne's result
 * is consumed internally by update(), the reminder sweep and the .ics builders,
 * all of which do real date arithmetic and need the Date objects. Converting in
 * the service would hand them strings. The copy below is deliberate for the
 * same reason -- mutating the row in place would change what those internal
 * callers see.
 *
 * There is no serializer interceptor doing this globally, so a new endpoint
 * that returns event rows without it ships the ISO form, and nothing fails
 * until someone looks at a date in the UI. The wire-format assertions in
 * events.e2e-spec.ts are the backstop.
 */
export type EventDateStrings<T> = Omit<T, 'eventDate' | 'eventTime'> & {
  eventDate: string;
  eventTime: string;
};

export function toEventDateStrings<T extends { eventDate: Date; eventTime: Date }>(
  event: T,
): EventDateStrings<T> {
  return {
    ...event,
    eventDate: toDateString(event.eventDate),
    eventTime: toTimeString(event.eventTime),
  };
}
