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

  it('leaves a real IPv6 address alone, lower-cased', () => {
    // Not mapped IPv4, so nothing to unwrap -- but `where: { ipAddress }` is
    // case-sensitive where IPv6 hex is not.
    expect(normalizeIp('2001:DB8::1')).toBe('2001:db8::1');
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

  // Only the mapped form is unwrapped: `::ffff:` in front of something that is
  // not dotted-quad is a genuine IPv6 address and must not be truncated.
  it('does not mangle an address that merely starts with the mapped prefix', () => {
    expect(normalizeIp('::ffff:0:203.0.113.4')).toBe('::ffff:0:203.0.113.4');
  });
});
