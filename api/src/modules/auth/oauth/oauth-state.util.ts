import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The signed OAuth `state` parameter (REQ-TENANT-01.8).
 *
 * Every OAuth callback in this deployment lands on one fixed host -- the root
 * tenant's -- because Google and Meta both require redirect URIs to be
 * registered in advance and neither supports a subdomain wildcard. So by the
 * time the provider redirects back, the request carries nothing that says which
 * community the member started from: the Host header is the callback host, and
 * the session cookie is host-only and therefore absent. `state` is the only
 * value that survives the round trip, which makes it the only thing that knows.
 *
 * **It decides three things, and getting it wrong is a cross-tenant account
 * takeover rather than a login bug:**
 *
 *  1. which tenant's user record the profile resolves against -- under
 *     per-tenant email uniqueness (REQ-TENANT-01.5) the same address is a
 *     different person in each community;
 *  2. which tenant's client secret the authorization code is exchanged with
 *     (REQ-TENANT-01.9);
 *  3. which host the resulting session is handed off to.
 *
 * An attacker who can choose the tenant in a callback chooses which community a
 * freshly authenticated session is issued for. v1's state was plain base64url,
 * which was safe only because the redirect allowlist was a single hardcoded
 * domain; under v2 the tenant is read *out* of it, so it has to be
 * unforgeable.
 *
 * **Deliberately not a JWT.** A JWT here would be signed by the same service
 * that mints sessions, and the whole risk in this file is a value being
 * mistaken for a more privileged one. The key is derived from `JWT_SECRET` by
 * HKDF under a distinct info label, so a state can never verify as a session
 * token and vice versa even though one secret backs both -- and no new
 * bootstrap variable is needed to get that separation.
 */

/** How long a member has to finish at the provider before `state` goes stale. */
const MAX_AGE_SECONDS = 15 * 60;

/**
 * Domain-separation label for the derived key. Changing it invalidates every
 * in-flight state, which is a sign-in retry rather than a session loss, so it
 * is safe to bump if this format ever changes incompatibly.
 */
const HKDF_INFO = 'communityevents:oauth-state:v1';

/** The wire payload, single-lettered because it travels in a query string. */
interface StatePayload {
  /** Tenant the login started from. The security-critical field. */
  t: number;
  /** Invite token the member arrived with, if any. */
  i?: string;
  /** Expiry, epoch seconds. */
  e: number;
  /** Random, so two states minted in the same second are not byte-identical. */
  n: string;
}

/** What a caller gets back from a state that verified. */
export interface OAuthState {
  tenantId: number;
  inviteToken?: string;
}

function stateKey(jwtSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', jwtSecret, '', HKDF_INFO, 32));
}

function sign(body: string, jwtSecret: string): string {
  return createHmac('sha256', stateKey(jwtSecret)).update(body).digest('base64url');
}

/**
 * Mints a `state` for the outbound redirect to the provider.
 *
 * @param jwtSecret the deployment's JWT_SECRET; the state key is derived from it
 */
export function encodeOAuthState(
  state: OAuthState,
  jwtSecret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const payload: StatePayload = {
    t: state.tenantId,
    e: nowSeconds + MAX_AGE_SECONDS,
    n: randomBytes(9).toString('base64url'),
  };
  if (state.inviteToken) payload.i = state.inviteToken;

  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body, jwtSecret)}`;
}

/**
 * Verifies a `state` from the provider's callback, or returns null.
 *
 * Returns null rather than throwing for every rejection -- malformed, wrong
 * signature, expired, structurally implausible -- because all of them mean the
 * same thing to the caller (do not trust this) and distinguishing them in an
 * error message would tell whoever sent it which part they got wrong.
 */
export function decodeOAuthState(
  raw: string | undefined,
  jwtSecret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): OAuthState | null {
  if (!raw) return null;

  const dot = raw.indexOf('.');
  if (dot <= 0 || dot === raw.length - 1) return null;

  const body = raw.slice(0, dot);
  const provided = Buffer.from(raw.slice(dot + 1), 'base64url');
  const expected = Buffer.from(sign(body, jwtSecret), 'base64url');

  // timingSafeEqual throws on a length mismatch rather than returning false,
  // and a truncated signature is exactly the input an attacker controls.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
  } catch {
    return null;
  }

  // Signature-verified, so this is our own payload -- but a stale format or a
  // bug on the minting side would still land here, and a tenant id that is not
  // a positive integer must never reach a database lookup.
  if (typeof payload.t !== 'number' || !Number.isInteger(payload.t) || payload.t <= 0) return null;
  if (typeof payload.e !== 'number' || payload.e <= nowSeconds) return null;

  return {
    tenantId: payload.t,
    inviteToken: typeof payload.i === 'string' && payload.i ? payload.i : undefined,
  };
}
