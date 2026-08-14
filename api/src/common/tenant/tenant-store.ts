import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Carries the current request's tenant down to the Prisma extension
 * (REQ-TENANT-01.3).
 *
 * AsyncLocalStorage rather than a request-scoped Nest provider, because the
 * enforcement point has to be the Prisma client itself. Making the client
 * `Scope.REQUEST` would make every one of the 40 services that injects it
 * request-scoped too, and then every service that injects *those* — the whole
 * graph gets rebuilt per request, and the parts with no request at all
 * (bootstrap, seed, the four @Cron sweeps) can no longer resolve it. ALS keeps
 * one singleton client whose behaviour varies with the ambient context, which
 * is exactly the shape of the problem.
 *
 * The context is established once, by TenantMiddleware, and covers everything
 * downstream of `next()` — guards, interceptors, controllers, services — because
 * async continuations inherit the store they were created in.
 */

interface TenantStore {
  /**
   * The tenant every scoped query is filtered to, or `null` when the caller has
   * deliberately opted out via `runUnscoped`.
   */
  readonly tenantId: number | null;
  /** Why scoping was waived. Only set on unscoped stores; used in errors. */
  readonly unscopedReason?: string;
}

const storage = new AsyncLocalStorage<TenantStore>();

/**
 * Runs `fn` with every tenant-scoped query filtered to `tenantId`.
 *
 * Called by TenantMiddleware with the tenant it just resolved from the Host
 * header. Anything awaited inside `fn` stays inside the context.
 *
 * **`fn` must await its queries, not just return them.** Prisma's promises are
 * lazy — the query is not sent until something calls `.then()` on it — so
 * `runWithTenant(id, () => prisma.events.findMany())` builds the promise inside
 * the context and then executes it outside, where the tenant is gone. Write
 * `runWithTenant(id, async () => await prisma.events.findMany())` instead. The
 * ordinary call shape is already safe: an `async` method invoked here runs its
 * body up to the first `await` synchronously, inside the context, and every
 * later continuation inherits it. This bites only when a callback hands the
 * promise straight back to a caller that awaits it. It fails closed rather than
 * silently — the extension sees no context and throws — everywhere except the
 * e2e suite, where the test fallback would quietly answer instead.
 */
export function runWithTenant<T>(tenantId: number, fn: () => T): T {
  return storage.run({ tenantId }, fn);
}

/**
 * Runs `fn` with tenant scoping deliberately switched off.
 *
 * For the code that legitimately has no single tenant: `bootstrap.ts` and
 * `seed.ts` (which run before, or independently of, any HTTP request), and the
 * scheduled sweeps that process every tenant's rows in one pass. `reason` is
 * required and is not decoration — it makes each waiver greppable and forces
 * the author to state one, since "unscoped" is the setting that turns this
 * whole mechanism off.
 *
 * Nesting is allowed and the innermost call wins, so a sweep may re-enter
 * `runWithTenant` per tenant.
 */
export function runUnscoped<T>(reason: string, fn: () => T): T {
  return storage.run({ tenantId: null, unscopedReason: reason }, fn);
}

/**
 * Tenant used when no context has been established at all — only ever set by
 * the e2e harness, and inert anywhere else.
 *
 * The e2e suite seeds its fixtures by calling Prisma directly rather than over
 * HTTP, in ~56 places across 28 spec files, so those calls have no request to
 * take a tenant from. AsyncLocalStorage cannot solve it: Vitest runs each hook
 * and each test body in a *sibling* async context, so neither `run()` around the
 * setup file nor `enterWith()` in a `beforeEach` is visible inside the `it` that
 * follows — verified, not assumed.
 *
 * A module-level fallback is deterministic where the async context is not. It is
 * only consulted when the ALS store is empty, which in the running application
 * is exactly the case the extension rejects, so this cannot loosen production
 * scoping — and `setTestTenantFallback` refuses to run outside NODE_ENV=test
 * regardless.
 */
let testTenantFallback: number | undefined;

/**
 * Test-only. Makes direct Prisma calls with no ambient context behave as though
 * they came from `tenantId`.
 *
 * Throws anywhere but NODE_ENV=test. Requests still open their own scope via
 * `runWithTenant`, which takes precedence, so a spec that exercises two tenants
 * over HTTP is unaffected by whatever this is set to.
 */
export function setTestTenantFallback(tenantId: number | undefined): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'setTestTenantFallback is a test seam and must never be called at runtime.',
    );
  }
  testTenantFallback = tenantId;
}

/**
 * The ambient tenant, or `null` if scoping was explicitly waived.
 *
 * Returns `undefined` when there is no context at all — a third state, not a
 * synonym for "unscoped". `undefined` means nobody decided, which the extension
 * treats as an error; `null` means somebody decided not to scope. Collapsing
 * the two would turn every forgotten context into a silent full-table read.
 */
export function currentTenantId(): number | null | undefined {
  const store = storage.getStore();
  if (store !== undefined) return store.tenantId;
  return testTenantFallback;
}

/** Whether a tenant context (scoped or explicitly unscoped) has been established. */
export function hasTenantContext(): boolean {
  return storage.getStore() !== undefined;
}

/**
 * The ambient tenant id, or an error.
 *
 * For raw SQL. `$queryRaw`/`$executeRaw` are not routed through Prisma
 * extensions at all, so those statements have to carry their own `tenant_id`
 * predicate — and this is where they get the value. It throws in exactly the two
 * cases the extension throws or would be wrong to run: no context established,
 * and scoping explicitly waived. A raw statement written against a scoped table
 * inside `runUnscoped` is either a cross-tenant sweep, in which case it should
 * not be calling this, or a mistake.
 *
 * @param usage short description of the statement, used in the error message
 */
export function requireTenantId(usage: string): number {
  const tenantId = currentTenantId();

  if (tenantId === undefined) {
    throw new Error(`No tenant context for ${usage}: it cannot run outside a request.`);
  }
  if (tenantId === null) {
    throw new Error(
      `${usage} needs a tenant, but scoping was waived by runUnscoped. ` +
        `Either scope the caller with runWithTenant or make the statement explicitly cross-tenant.`,
    );
  }

  return tenantId;
}
