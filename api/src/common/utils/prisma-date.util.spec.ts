import {
  asDateString,
  asTimeString,
  toDateColumn,
  toDateString,
  toEventDateStrings,
  toTimeColumn,
  toTimeString,
} from './prisma-date.util';

/**
 * These four conversions sit between MySQL's DATE/TIME columns and the
 * 'YYYY-MM-DD' / 'HH:MM:SS' strings the API publishes. A UTC-vs-local slip in
 * any of them moves an event by hours or a whole day, and the failure shows up
 * far away — as a wrong date in the UI, or an .ics that lands on the wrong
 * evening.
 *
 * Everything below anchors to UTC deliberately. If any of these functions
 * reached for a local getter, these tests would pass on a UTC machine and fail
 * on Rob's, which is exactly the bug being guarded against.
 */
describe('toDateString / toTimeString', () => {
  it('formats a DATE column as YYYY-MM-DD', () => {
    expect(toDateString(new Date('2026-08-11T00:00:00Z'))).toBe('2026-08-11');
  });

  it('formats a TIME column as HH:MM:SS', () => {
    // A TIME column comes back as a Date on 1970-01-01 carrying only the clock.
    expect(toTimeString(new Date('1970-01-01T18:30:00Z'))).toBe('18:30:00');
  });

  it('zero-pads single-digit components', () => {
    expect(toDateString(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01-05');
    expect(toTimeString(new Date('1970-01-01T09:05:03Z'))).toBe('09:05:03');
  });

  it('reads UTC, not local — a UTC-midnight date keeps its own day', () => {
    // The regression behind the "events show a day early" bug: with a local
    // getter this returns 2026-08-10 anywhere west of Greenwich.
    expect(toDateString(new Date('2026-08-11T00:00:00Z'))).toBe('2026-08-11');
  });
});

describe('toDateColumn / toTimeColumn', () => {
  it('parses a date string as UTC midnight', () => {
    expect(toDateColumn('2026-08-11').toISOString()).toBe('2026-08-11T00:00:00.000Z');
  });

  it('parses HH:MM:SS onto the 1970 epoch day', () => {
    expect(toTimeColumn('18:30:00').toISOString()).toBe('1970-01-01T18:30:00.000Z');
  });

  it('accepts HH:MM, which is what the event form submits', () => {
    expect(toTimeColumn('18:30').toISOString()).toBe('1970-01-01T18:30:00.000Z');
  });
});

describe('round-tripping', () => {
  it('survives date -> column -> string unchanged', () => {
    for (const date of ['2026-01-01', '2026-08-11', '2026-12-31', '2027-02-28']) {
      expect(toDateString(toDateColumn(date))).toBe(date);
    }
  });

  it('survives time -> column -> string unchanged', () => {
    for (const time of ['00:00:00', '09:05:03', '18:30:00', '23:59:59']) {
      expect(toTimeString(toTimeColumn(time))).toBe(time);
    }
  });
});

describe('asDateString / asTimeString', () => {
  // Tolerant variants: during the swap some callers were fed Dates by Prisma
  // and strings by services still on TypeORM.
  it('passes a string through untouched', () => {
    expect(asDateString('2026-08-11')).toBe('2026-08-11');
    expect(asTimeString('18:30:00')).toBe('18:30:00');
  });

  it('converts a Date the same way the strict variants do', () => {
    expect(asDateString(new Date('2026-08-11T00:00:00Z'))).toBe('2026-08-11');
    expect(asTimeString(new Date('1970-01-01T18:30:00Z'))).toBe('18:30:00');
  });
});

describe('toEventDateStrings', () => {
  const row = () => ({
    id: 7,
    title: 'Tuesday Dinner',
    eventDate: new Date('2026-08-11T00:00:00Z'),
    eventTime: new Date('1970-01-01T18:30:00Z'),
  });

  it('replaces both columns with their string forms', () => {
    const out = toEventDateStrings(row());
    expect(out.eventDate).toBe('2026-08-11');
    expect(out.eventTime).toBe('18:30:00');
  });

  it('leaves every other field alone', () => {
    const out = toEventDateStrings(row());
    expect(out.id).toBe(7);
    expect(out.title).toBe('Tuesday Dinner');
  });

  it('does not mutate the row it was given', () => {
    // Load-bearing: findOne's result is reused internally by update(), the
    // reminder sweep and the .ics builders, all of which need real Dates.
    // Mutating in place would hand them strings.
    const original = row();
    toEventDateStrings(original);
    expect(original.eventDate).toBeInstanceOf(Date);
    expect(original.eventTime).toBeInstanceOf(Date);
  });

  it('produces JSON with no ISO timestamps in either field', () => {
    // The actual regression: JSON.stringify on an unconverted row emitted
    // "2026-08-11T00:00:00.000Z" and "1970-01-01T18:30:00.000Z".
    const json = JSON.parse(JSON.stringify(toEventDateStrings(row())));
    expect(json.eventDate).toBe('2026-08-11');
    expect(json.eventTime).toBe('18:30:00');
  });
});
