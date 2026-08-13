import type { tenants_status } from '@prisma/client';

/**
 * The resolved tenant for the current request, attached by TenantMiddleware
 * (REQ-TENANT-01.2) before any route handler runs.
 *
 * Deliberately a narrow projection of the `tenants` row rather than the row
 * itself: the reserved OAuth credential columns include two secrets that must
 * be encrypted at rest before anything writes them, and hanging the whole row
 * off every request is how they end up serialised into a response by accident.
 * Widen this when something actually needs a field.
 */
export interface TenantContext {
  id: number;
  slug: string;
  domain: string;
  isRoot: boolean;
  status: tenants_status;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Set by TenantMiddleware on every request that reaches a handler.
       *
       * Optional in the type because the middleware is skipped for the health
       * endpoint, and because Express constructs the object long before the
       * middleware runs — not because a handler should expect it to be
       * missing. Anywhere downstream of the middleware it is always set: the
       * request 404s otherwise.
       */
      tenant?: TenantContext;
    }
  }
}
