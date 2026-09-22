import { describe, expect, it } from 'vitest';
import { normalizeIp } from './demo.service';

/**
 * One spelling per client, so the per-IP cap counts what it thinks it counts
 * (v2-14).
 *
 * Node reports an IPv4 client on a dual-stack socket as `::ffff:203.0.113.4`
 * and the same client elsewhere as `203.0.113.4`. Stored as-is those are two
 * addresses, and the cap silently doubles for anyone whose requests land on
 * different sockets.
 *
 * The bug that brought this to light was bigger -- Express was not trusting the
 * reverse proxy, so *every* request in the system reported
 * `::ffff:127.0.0.1`, making the per-IP cap a deployment-wide cap of two and
 * the rate limiter a deployment-wide bucket. That is fixed in `main.ts`; this
 * is the smaller half, and the mapped-IPv4 form is exactly what showed up in
 * the table while it was broken.
 */
describe('normalizeIp', () => {
  it('unwraps an IPv4-mapped IPv6 address', () => {
    expect(normalizeIp('::ffff:203.0.113.4')).toBe('203.0.113.4');
    expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it('gives a mapped and a bare address the same spelling', () => {
    expect(normalizeIp('::ffff:74.115.41.25')).toBe(normalizeIp('74.115.41.25'));
  });

  it('lower-cases, since IPv6 hex is case-insensitive and the query is not', () => {
    // `where: { ipAddress }` compares exactly, so two spellings of one address
    // would be two buckets. (The prefix bucketing below is what turns this
    // into `2001:db8:0:0::` rather than leaving the host portion on.)
    expect(normalizeIp('2001:DB8::1')).toBe(normalizeIp('2001:db8::1'));
    expect(normalizeIp('2001:DB8::1')).toBe('2001:db8:0:0::');
  });

  it('leaves a plain IPv4 address alone', () => {
    expect(normalizeIp('192.168.2.241')).toBe('192.168.2.241');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeIp('  203.0.113.4  ')).toBe('203.0.113.4');
  });

  // An absent address must stay absent rather than becoming a shared empty
  // string, which every caller with no IP would then collide on.
  it('passes an unknown address through as undefined', () => {
    expect(normalizeIp(undefined)).toBeUndefined();
    expect(normalizeIp('')).toBeUndefined();
  });

  describe('IPv6, which rotates', () => {
    /**
     * A modern client does not have *an* IPv6 address -- privacy extensions
     * hand it a fresh one from its allocation as often as hourly. Counting the
     * full address means the cap resets whenever the host portion rolls over,
     * which is to say it does not apply to most home connections. Bucketing by
     * the routing prefix is what makes it bind.
     */
    it('buckets rotating addresses from one allocation together', () => {
      // Rob's real address, and what privacy extensions would make of it an
      // hour later.
      const now = '2600:2b00:945e:9000:4493:648f:ebe2:248d';
      const later = '2600:2b00:945e:9000:1111:2222:3333:4444';

      expect(normalizeIp(now)).toBe(normalizeIp(later));
      expect(normalizeIp(now)).toBe('2600:2b00:945e:9000::');
    });

    it('keeps genuinely different allocations apart', () => {
      expect(normalizeIp('2600:2b00:945e:9000::1')).not.toBe(
        normalizeIp('2600:2b00:945e:9001::1'),
      );
    });

    /**
     * The compression trap: `2600:2b00::1` is 2600, 2b00, 0, 0, ... , 1. Taking
     * the first four groups as written would read it as 2600, 2b00, 1 and
     * bucket it with something else entirely.
     */
    it('expands :: before taking the prefix', () => {
      expect(normalizeIp('2600:2b00::1')).toBe('2600:2b00:0:0::');
      expect(normalizeIp('::1')).toBe('0:0:0:0::');
    });

    it('strips a zone index', () => {
      expect(normalizeIp('fe80::1%eth0')).toBe('fe80:0:0:0::');
    });

    it('is stable however the same prefix is written', () => {
      expect(normalizeIp('2600:2b00:0000:0000:1:2:3:4')).toBe(normalizeIp('2600:2b00::1:2:3:4'));
    });

    // Anything unparseable is passed through rather than bucketed into an
    // invented prefix that could collide with a real one.
    it('passes a malformed address through untouched', () => {
      expect(normalizeIp('not::an::address')).toBe('not::an::address');
      expect(normalizeIp('2600:zzzz::1')).toBe('2600:zzzz::1');
    });
  });
});
