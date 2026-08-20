import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_COOKIE,
  accessTokenCookieOptions,
  staleAccessTokenCookieVariants,
} from './auth-cookie.util';

/**
 * The session cookie's *scope* is a security property, not a formatting detail:
 * under v2 a tenant is a domain, so a `domain` attribute on this cookie is one
 * login shared across every community on the deployment. It carried
 * `domain: BASE_DOMAIN` until v2-6, which is exactly that bug, so the absence of
 * the attribute is worth asserting rather than assuming.
 */
describe('access token cookie', () => {
  it('is host-only — no domain attribute at all', () => {
    expect(accessTokenCookieOptions()).not.toHaveProperty('domain');
  });

  it('is httpOnly, strict and path-wide', () => {
    const options = accessTokenCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('strict');
    expect(options.path).toBe('/');
  });

  it('lives for seven days', () => {
    expect(accessTokenCookieOptions().maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('is named access_token', () => {
    expect(ACCESS_TOKEN_COOKIE).toBe('access_token');
  });

  describe('clearing stale variants', () => {
    // A cookie set with one (domain, secure) combination is not replaced by a
    // Set-Cookie using another — it sits alongside it, and the browser may send
    // either. Every combination the app has ever set has to be cleared or a
    // dead session can outlive a fresh login.
    it('covers both Secure flags for the host-only cookie', () => {
      const variants = staleAccessTokenCookieVariants(undefined);

      expect(variants).toHaveLength(2);
      expect(variants.every((v) => v.domain === undefined)).toBe(true);
      expect(variants.map((v) => v.secure).sort()).toEqual([false, true]);
    });

    // The migration case: sessions issued before v2-6 hold a domain-scoped
    // cookie that a host-only Set-Cookie cannot touch, and it would otherwise
    // outlive the change by up to seven days — still shared across tenants.
    it('also covers the legacy domain-scoped pair when a domain is given', () => {
      const variants = staleAccessTokenCookieVariants('example.com');

      expect(variants).toHaveLength(4);
      const legacy = variants.filter((v) => v.domain === 'example.com');
      expect(legacy).toHaveLength(2);
      expect(legacy.map((v) => v.secure).sort()).toEqual([false, true]);
    });

    it('every variant clears the same path the cookie was set on', () => {
      for (const variant of staleAccessTokenCookieVariants('example.com')) {
        expect(variant.path).toBe(accessTokenCookieOptions().path);
      }
    });
  });
});
