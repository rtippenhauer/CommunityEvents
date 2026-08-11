import { computeRsvpCutoffAt, isPastRsvpCutoff } from './rsvp-cutoff.util';

/**
 * RSVP closes 150 minutes before the event's Eastern wall-clock start. Until
 * now this was only exercised through HTTP: an off-by-one here surfaced as
 * "the RSVP endpoint returned 400", several layers from the arithmetic that
 * actually got it wrong.
 *
 * Every expectation below is an absolute UTC instant, because that is the only
 * form that is unambiguous — asserting on local strings would make the suite
 * pass or fail depending on the machine's timezone.
 */
describe('computeRsvpCutoffAt', () => {
  it('subtracts 150 minutes from an evening event during EDT', () => {
    // 2026-07-14 18:30 Eastern = 22:30Z (UTC-4). Cutoff 16:00 EDT = 20:00Z.
    expect(computeRsvpCutoffAt('2026-07-14', '18:30').toISOString()).toBe('2026-07-14T20:00:00.000Z');
  });

  it('subtracts 150 minutes from an evening event during EST', () => {
    // Same wall-clock time in January is UTC-5, so the cutoff is an hour later
    // in UTC. Hard-coding a single offset would break for half the year.
    expect(computeRsvpCutoffAt('2027-01-05', '18:30').toISOString()).toBe('2027-01-05T21:00:00.000Z');
  });

  it('accepts an HH:MM:SS time as well as HH:MM', () => {
    // The DB column is TIME and reads back as '18:30:00'; the event form sends
    // '18:30'. Both reach this function.
    expect(computeRsvpCutoffAt('2026-07-14', '18:30:00').toISOString()).toBe(
      computeRsvpCutoffAt('2026-07-14', '18:30').toISOString(),
    );
  });

  describe('events early enough that the cutoff lands on the previous Eastern day', () => {
    // Note the asymmetry these pin down: the cutoff rolls back to the previous
    // *Eastern* calendar day, but because Eastern is behind UTC, the resulting
    // UTC instant often still falls on the original date. 22:30 Eastern on the
    // 13th is 02:30Z on the 14th. Reading the rollback as a UTC-date rollback
    // is the easy mistake here, and it is the one these catch.
    it('rolls back the Eastern date for a 01:00 event', () => {
      // 01:00 minus 150 minutes is 22:30 the previous evening, not a negative
      // time on the same day.
      expect(computeRsvpCutoffAt('2026-07-14', '01:00').toISOString()).toBe('2026-07-14T02:30:00.000Z');
    });

    it('rolls back across a month boundary', () => {
      // 22:00 Eastern on Jul 31 -> 02:00Z on Aug 1.
      expect(computeRsvpCutoffAt('2026-08-01', '00:30').toISOString()).toBe('2026-08-01T02:00:00.000Z');
    });

    it('rolls back across a year boundary', () => {
      // 23:30 Eastern on Dec 31 -> 04:30Z on Jan 1.
      expect(computeRsvpCutoffAt('2027-01-01', '02:00').toISOString()).toBe('2027-01-01T04:30:00.000Z');
    });
  });

  describe('daylight-saving transitions', () => {
    // Spring forward 2026-03-08, fall back 2026-11-01. An event just after a
    // transition has its cutoff just before it, so the two are on different
    // UTC offsets — the case a fixed-offset implementation gets wrong.
    it('handles an event the morning the clocks spring forward', () => {
      expect(computeRsvpCutoffAt('2026-03-08', '05:00').toISOString()).toBe('2026-03-08T07:30:00.000Z');
    });

    it('handles an event the morning the clocks fall back', () => {
      expect(computeRsvpCutoffAt('2026-11-01', '05:00').toISOString()).toBe('2026-11-01T06:30:00.000Z');
    });
  });
});

describe('isPastRsvpCutoff', () => {
  const eventDate = '2026-07-14';
  const eventTime = '18:30';
  // Cutoff is 2026-07-14T20:00:00Z.

  it('is false a minute before the cutoff', () => {
    expect(isPastRsvpCutoff(eventDate, eventTime, new Date('2026-07-14T19:59:00Z'))).toBe(false);
  });

  it('is true exactly at the cutoff', () => {
    // The boundary is inclusive (>=) — at the cutoff instant RSVP is closed.
    expect(isPastRsvpCutoff(eventDate, eventTime, new Date('2026-07-14T20:00:00Z'))).toBe(true);
  });

  it('is true a minute after the cutoff', () => {
    expect(isPastRsvpCutoff(eventDate, eventTime, new Date('2026-07-14T20:01:00Z'))).toBe(true);
  });

  it('is false well in advance of the event', () => {
    expect(isPastRsvpCutoff(eventDate, eventTime, new Date('2026-07-01T12:00:00Z'))).toBe(false);
  });
});
