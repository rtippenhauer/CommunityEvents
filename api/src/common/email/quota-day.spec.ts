import { describe, expect, it } from 'vitest';
import { DEFAULT_QUOTA_TIME_ZONE, quotaDayStart, resolveQuotaTimeZone } from './quota-day';

/**
 * The bug these exist for, in one line: two invites four hours apart landed
 * either side of UTC midnight, so both communities' screens read `1 / 300`
 * while Brevo had counted all four of the evening's messages against one
 * allowance.
 *
 * The visible symptom was a confusing screen. The one that matters is that
 * between our rollover and the provider's, the deployment believes it has a
 * fresh allowance while the provider is still spending the old one -- so the
 * guard waves through exactly the overage it exists to prevent.
 */
describe('quota day boundary', () => {
  describe('resolveQuotaTimeZone', () => {
    it('defaults to UTC when nothing is configured', () => {
      expect(resolveQuotaTimeZone(undefined)).toEqual({ timeZone: DEFAULT_QUOTA_TIME_ZONE });
      expect(resolveQuotaTimeZone('')).toEqual({ timeZone: 'UTC' });
      expect(resolveQuotaTimeZone('   ')).toEqual({ timeZone: 'UTC' });
    });

    it('accepts an IANA zone', () => {
      expect(resolveQuotaTimeZone('America/New_York')).toEqual({ timeZone: 'America/New_York' });
      expect(resolveQuotaTimeZone(' Europe/London ')).toEqual({ timeZone: 'Europe/London' });
    });

    it('falls back rather than throwing on a name it does not know', () => {
      // A mistyped zone must not stop a deployment sending mail. It keeps the
      // behaviour it had before the setting existed, which is safe, and the
      // caller logs the name it could not use.
      expect(resolveQuotaTimeZone('Mars/Olympus_Mons')).toEqual({
        timeZone: 'UTC',
        invalid: 'Mars/Olympus_Mons',
      });
    });
  });

  describe('quotaDayStart', () => {
    it('is UTC midnight when the zone is UTC', () => {
      const start = quotaDayStart(new Date('2026-08-25T21:31:00.000Z'), 'UTC');
      expect(start.toISOString()).toBe('2026-08-25T00:00:00.000Z');
    });

    it('puts the two sends that started this in the same day', () => {
      // 5:31pm and 9:24pm US Eastern on the 25th. Under the old UTC comparison
      // the second one is already the 26th, which is what zeroed the counter
      // between them.
      const first = quotaDayStart(new Date('2026-08-25T21:31:00.000Z'), 'America/New_York');
      const second = quotaDayStart(new Date('2026-08-26T01:24:00.000Z'), 'America/New_York');

      expect(first.toISOString()).toBe('2026-08-25T04:00:00.000Z');
      expect(second.getTime()).toBe(first.getTime());

      // And the old behaviour, for contrast -- same two instants, two days.
      expect(quotaDayStart(new Date('2026-08-25T21:31:00.000Z'), 'UTC').getTime()).not.toBe(
        quotaDayStart(new Date('2026-08-26T01:24:00.000Z'), 'UTC').getTime(),
      );
    });

    it('handles a zone ahead of UTC', () => {
      // 8am on the 26th in Tokyo is still the 25th in UTC.
      const start = quotaDayStart(new Date('2026-08-25T23:00:00.000Z'), 'Asia/Tokyo');
      expect(start.toISOString()).toBe('2026-08-25T15:00:00.000Z');
    });

    it('uses the offset in force at midnight, not the one in force now', () => {
      // US clocks go back at 2am local on 2026-11-01, so that day starts on EDT
      // (UTC-4) and ends on EST (UTC-5). Reading the current offset and
      // subtracting it would put the boundary an hour out for the whole day.
      const afternoon = quotaDayStart(new Date('2026-11-01T18:00:00.000Z'), 'America/New_York');
      expect(afternoon.toISOString()).toBe('2026-11-01T04:00:00.000Z');

      // Spring forward: 2026-03-08 starts on EST and ends on EDT.
      const spring = quotaDayStart(new Date('2026-03-08T20:00:00.000Z'), 'America/New_York');
      expect(spring.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    });

    it('is stable for every instant inside one day', () => {
      const zone = 'America/New_York';
      const start = quotaDayStart(new Date('2026-08-25T04:00:00.000Z'), zone);
      for (let hour = 0; hour < 24; hour++) {
        const inside = new Date(start.getTime() + hour * 3600_000);
        expect(quotaDayStart(inside, zone).getTime()).toBe(start.getTime());
      }
      // One millisecond earlier belongs to the previous day.
      expect(quotaDayStart(new Date(start.getTime() - 1), zone).getTime()).toBeLessThan(
        start.getTime(),
      );
    });

    it('is not affected by the process’s own time zone', () => {
      // The whole calculation goes through Intl and getUTC*; nothing reads the
      // host clock's zone. Asserting the UTC case pins that: if any local-time
      // arithmetic crept in, this would drift by the CI machine's offset.
      const start = quotaDayStart(new Date('2026-01-15T12:00:00.000Z'), 'UTC');
      expect(start.toISOString()).toBe('2026-01-15T00:00:00.000Z');
    });
  });
});
