import { describe, expect, it } from 'vitest';
import { createHmac, hkdfSync } from 'node:crypto';
import { decodeOAuthState, encodeOAuthState } from './oauth-state.util';

const SECRET = 'test-jwt-secret-value';
const OTHER_SECRET = 'a-different-deployment-secret';

/**
 * Signs an arbitrary payload the way the util does, so a test can present a
 * structurally invalid payload that is nonetheless correctly signed. Repeating
 * the derivation here rather than exporting a seam also pins the wire format.
 */
function signLocally(payload: unknown): string {
  const key = Buffer.from(hkdfSync('sha256', SECRET, '', 'communityevents:oauth-state:v1', 32));
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
}

describe('oauth state', () => {
  it('round-trips the tenant and invite token', () => {
    const encoded = encodeOAuthState({ tenantId: 7, inviteToken: 'inv-abc' }, SECRET);
    expect(decodeOAuthState(encoded, SECRET)).toEqual({ tenantId: 7, inviteToken: 'inv-abc' });
  });

  it('omits the invite token when there was none', () => {
    const encoded = encodeOAuthState({ tenantId: 3 }, SECRET);
    expect(decodeOAuthState(encoded, SECRET)).toEqual({ tenantId: 3, inviteToken: undefined });
  });

  it('is unique per mint, so two states for one tenant differ', () => {
    const a = encodeOAuthState({ tenantId: 1 }, SECRET);
    const b = encodeOAuthState({ tenantId: 1 }, SECRET);
    expect(a).not.toEqual(b);
  });

  // The whole point of the file: the tenant id is read back out of this value
  // and decides which community a session is issued for.
  it('rejects a payload edited to name another tenant', () => {
    const encoded = encodeOAuthState({ tenantId: 1 }, SECRET);
    const [body, signature] = encoded.split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { t: number };
    decoded.t = 2;
    const forged = `${Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url')}.${signature}`;

    expect(decodeOAuthState(forged, SECRET)).toBeNull();
  });

  it('rejects a state signed by another deployment', () => {
    const encoded = encodeOAuthState({ tenantId: 1 }, OTHER_SECRET);
    expect(decodeOAuthState(encoded, SECRET)).toBeNull();
  });

  it('rejects an expired state', () => {
    const now = Math.floor(Date.now() / 1000);
    const encoded = encodeOAuthState({ tenantId: 1 }, SECRET, now);
    expect(decodeOAuthState(encoded, SECRET, now + 14 * 60)).not.toBeNull();
    expect(decodeOAuthState(encoded, SECRET, now + 16 * 60)).toBeNull();
  });

  // timingSafeEqual throws on a length mismatch instead of returning false, and
  // a truncated signature is exactly what an attacker supplies.
  it('rejects a truncated signature without throwing', () => {
    const encoded = encodeOAuthState({ tenantId: 1 }, SECRET);
    const [body, signature] = encoded.split('.');
    expect(decodeOAuthState(`${body}.${signature.slice(0, 8)}`, SECRET)).toBeNull();
  });

  it.each([
    ['undefined', undefined],
    ['empty', ''],
    ['unsigned', 'eyJ0IjoxfQ'],
    ['dot only', '.'],
    ['no body', '.abcdef'],
    ['no signature', 'eyJ0IjoxfQ.'],
    ['not base64url', '!!!.???'],
  ])('rejects a %s state', (_label, raw) => {
    expect(decodeOAuthState(raw, SECRET)).toBeNull();
  });

  // Correctly signed, so only the payload guard can reject these. The guard is
  // there for a stale format or a bug on the minting side -- a tenant id that
  // is not a positive integer must never reach a database lookup.
  it.each([0, -1, 1.5, '1', null])('rejects a correctly signed state whose tenant id is %s', (t) => {
    const payload = { t, e: Math.floor(Date.now() / 1000) + 60, n: 'nonce' };
    expect(decodeOAuthState(signLocally(payload), SECRET)).toBeNull();
  });

  it('rejects a correctly signed state with no expiry', () => {
    expect(decodeOAuthState(signLocally({ t: 1, n: 'nonce' }), SECRET)).toBeNull();
  });
});
