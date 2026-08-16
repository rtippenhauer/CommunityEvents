import type { CookieOptions } from 'express';

export const ACCESS_TOKEN_COOKIE = 'access_token';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Options for the session cookie (REQ-TENANT-01.7).
 *
 * **Host-only, deliberately: there is no `domain`.** A cookie without a Domain
 * attribute is returned only to the exact host that set it, never to siblings
 * and never to subdomains. Under v2 a tenant *is* a domain, so this is the
 * difference between a session that belongs to one community and a session that
 * belongs to all of them.
 *
 * It used to carry `domain: BASE_DOMAIN`, and the comment there explained that
 * as letting a session started on one chapter subdomain work on the others.
 * That was a reasonable thing to want when every subdomain was the same
 * community; it is precisely the wrong thing now, because `.example.com` covers
 * every tenant under it. Scoping to the apex would have shared one login across
 * every community on the deployment.
 *
 * A consequence worth stating plainly: **Google's OAuth round-trip lands on a
 * single fixed callback host**, so a host-only cookie set there does not travel
 * back to a different tenant's host. OAuth therefore works on the tenant that
 * owns the callback URL and not on the others until REQ-TENANT-01.8's signed
 * `state` handoff exists (v2-8, alongside per-tenant OAuth credentials —
 * building the handoff before those exist would mean building it twice).
 * Email/password login is unaffected and works on every tenant today.
 *
 * `secure` follows NODE_ENV because local development is plain HTTP.
 */
export function accessTokenCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: SEVEN_DAYS_MS,
    path: '/',
  };
}

/**
 * Every variant of the session cookie a browser might still be holding.
 *
 * A cookie's identity to the browser is (name, domain, path) and — for
 * overwriting purposes — its Secure flag matters too, so a cookie set with one
 * combination is not replaced by a `Set-Cookie` using another. It sits alongside
 * it, and whichever the browser decides to send can carry a dead session, which
 * looks to the user like a fresh login that "didn't stick".
 *
 * Two separate reasons to clear more than one:
 *
 *  - A NODE_ENV flip between deploys changes `secure`, which is why the pair of
 *    secure/insecure clears already existed.
 *  - **v2-6 moved the cookie from `domain: BASE_DOMAIN` to host-only.** Every
 *    session issued before that upgrade is holding a domain-scoped cookie that a
 *    host-only `Set-Cookie` cannot touch, and it would outlive the change by up
 *    to its seven-day lifetime — on the wrong scope, still shared across
 *    tenants. Clearing the legacy domain variants is what makes the migration
 *    take effect on the next login rather than a week later.
 *
 * Safe to keep indefinitely: clearing a cookie that was never set is a no-op.
 * Removable once no session predating the v2-6 deploy can still exist.
 */
export function staleAccessTokenCookieVariants(legacyDomain: string | undefined): CookieOptions[] {
  const variants: CookieOptions[] = [
    { path: '/', secure: true },
    { path: '/', secure: false },
  ];

  if (legacyDomain) {
    variants.push(
      { path: '/', domain: legacyDomain, secure: true },
      { path: '/', domain: legacyDomain, secure: false },
    );
  }

  return variants;
}
