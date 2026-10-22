import { describe, expect, it } from 'vitest';
import { clientIpFrom } from './client-ip.util';

/**
 * The stage measurement that prompted this: 35 requests from one laptop all
 * recorded a Cloudflare edge address, because `req.ip` stops at the last
 * trusted proxy.
 */
describe('clientIpFrom', () => {
  it('prefers the address Cloudflare reports over the edge node Express sees', () => {
    expect(
      clientIpFrom({
        ip: '104.22.151.132', // what the log actually recorded on stage
        headers: { 'cf-connecting-ip': '203.0.113.7' },
      }),
    ).toBe('203.0.113.7');
  });

  it('falls back to req.ip when the header is absent', () => {
    expect(clientIpFrom({ ip: '198.51.100.4', headers: {} })).toBe('198.51.100.4');
  });

  it('falls back to the socket when there is no req.ip either', () => {
    expect(clientIpFrom({ headers: {}, socket: { remoteAddress: '::1' } })).toBe('::1');
  });

  it('returns null rather than a misleading placeholder when nothing is known', () => {
    expect(clientIpFrom({})).toBeNull();
  });

  it('ignores a blank header instead of recording an empty address', () => {
    expect(clientIpFrom({ ip: '198.51.100.4', headers: { 'cf-connecting-ip': '   ' } })).toBe(
      '198.51.100.4',
    );
  });

  it('takes the first value when the header arrives more than once', () => {
    expect(
      clientIpFrom({ ip: '10.0.0.1', headers: { 'cf-connecting-ip': ['203.0.113.7', '203.0.113.8'] } }),
    ).toBe('203.0.113.7');
  });
});
