import { afterEach, describe, expect, it } from 'vitest';
import {
  currentTenantId,
  hasTenantContext,
  requireTenantId,
  runUnscoped,
  runWithTenant,
  setTestTenantFallback,
} from './tenant-store';

/**
 * The store's contract is three states, not two, and the distinction is the
 * whole safety property: "no context" must never be mistaken for "unscoped".
 */
describe('tenant store', () => {
  // These specs assert on the no-context state, which the e2e harness's fallback
  // would otherwise mask. Cleared per test and left cleared.
  afterEach(() => setTestTenantFallback(undefined));

  it('reports no context outside any scope', () => {
    expect(currentTenantId()).toBeUndefined();
    expect(hasTenantContext()).toBe(false);
  });

  it('exposes the tenant inside runWithTenant', () => {
    runWithTenant(7, () => {
      expect(currentTenantId()).toBe(7);
      expect(hasTenantContext()).toBe(true);
    });
  });

  it('distinguishes an explicit waiver from no context at all', () => {
    runUnscoped('a sweep', () => {
      expect(currentTenantId()).toBeNull();
      expect(hasTenantContext()).toBe(true);
    });
  });

  it('restores the previous state when a scope exits', () => {
    runWithTenant(7, () => {
      expect(currentTenantId()).toBe(7);
    });
    expect(currentTenantId()).toBeUndefined();
  });

  it('lets the innermost scope win, so a sweep can re-enter per tenant', () => {
    runUnscoped('a sweep', () => {
      expect(currentTenantId()).toBeNull();
      runWithTenant(3, () => expect(currentTenantId()).toBe(3));
      expect(currentTenantId()).toBeNull();
    });
  });

  it('carries the tenant across an await', async () => {
    await runWithTenant(11, async () => {
      await Promise.resolve();
      expect(currentTenantId()).toBe(11);
    });
  });

  it('keeps concurrent scopes from seeing each other', async () => {
    const seen: number[] = [];
    const capture = (tenantId: number, delay: number) =>
      runWithTenant(tenantId, async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        seen.push(currentTenantId() as number);
      });

    // The slower one is started first on purpose: if the store leaked between
    // them, the interleaving is what would expose it.
    await Promise.all([capture(1, 20), capture(2, 5)]);

    expect(seen).toEqual([2, 1]);
  });

  describe('requireTenantId', () => {
    it('returns the tenant inside a scope', () => {
      runWithTenant(5, () => expect(requireTenantId('a raw query')).toBe(5));
    });

    it('throws with no context, naming the caller', () => {
      expect(() => requireTenantId('a raw query')).toThrow(/No tenant context for a raw query/);
    });

    it('throws inside runUnscoped rather than silently spanning tenants', () => {
      runUnscoped('a sweep', () => {
        expect(() => requireTenantId('a raw query')).toThrow(/scoping was waived/);
      });
    });
  });

  describe('setTestTenantFallback', () => {
    it('only applies where no real scope exists', () => {
      setTestTenantFallback(42);
      expect(currentTenantId()).toBe(42);

      runWithTenant(8, () => expect(currentTenantId()).toBe(8));
      runUnscoped('a sweep', () => expect(currentTenantId()).toBeNull());

      expect(currentTenantId()).toBe(42);
    });

    it('refuses to run outside a test environment', () => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        expect(() => setTestTenantFallback(1)).toThrow(/must never be called at runtime/);
      } finally {
        process.env.NODE_ENV = previous;
      }
    });
  });
});
