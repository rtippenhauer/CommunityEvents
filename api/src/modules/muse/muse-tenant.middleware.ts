import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runWithTenant } from '../../common/tenant/tenant-store';
import { ApiTokenService, type VerifiedToken } from '../integrations/api-token.service';

/**
 * Resolves the community for a Muse call from the **token**, not the Host header
 * (v2-29).
 *
 * This is the one part of v1's Phase 39 that could not be ported literally: v1
 * is single-tenant and had nothing to resolve. An integration call carries no
 * session and no cookie, so `api_tokens.tenant_id` is the only trustworthy
 * statement about which community it belongs to.
 *
 * ## Why a middleware and not just the guard
 *
 * The tenant reaches the Prisma extension through AsyncLocalStorage, and that
 * context has to be established *around* `next()` -- a guard runs inside the
 * context `TenantMiddleware` already opened and returns before the handler
 * runs, so a `runWithTenant` call in a guard would be gone by the time any
 * query executed. Only middleware can wrap the rest of the request.
 *
 * It therefore runs **after** `TenantMiddleware`, nesting inside it. Nesting is
 * explicitly allowed by `tenant-store.ts` and the innermost call wins, so the
 * host's tenant is replaced by the token's for the remainder of the request.
 *
 * ## When the two disagree
 *
 * The token wins, and the disagreement is logged rather than refused. It is not
 * a leak: the token belongs to the community whose data it then reads, so a
 * community's own token presented to another community's host operates on its
 * *own* rows and sees nothing of the host's. Refusing instead would make the
 * base URL load-bearing again, which is the coupling this design removes --
 * v1's spec has Muse changing base URL and token together, and keeping the two
 * independent is what lets one Muse instance drive several communities later
 * without a schema change.
 *
 * It is still worth a loud log, because in every expected configuration they
 * match, so a mismatch means somebody has pointed Muse at the wrong host.
 *
 * ## Authentication is still the guard's job
 *
 * This middleware deliberately does **not** reject anything. A bad token simply
 * establishes no tenant and leaves `req.museToken` unset, and `MuseTokenGuard`
 * returns the 401. Two reasons: middleware cannot use `GlobalExceptionFilter`
 * (it wraps route handlers, so a throw here unwinds to Express's stock HTML
 * error page -- the trap `v2-4` recorded), and authentication that lives in two
 * places is authentication nobody can audit in one.
 */
declare module 'express' {
  interface Request {
    /** Set only on a Muse route, only when the bearer token verified. */
    museToken?: VerifiedToken;
  }
}

/** `Authorization: Bearer cet_...` and nothing else -- never a query parameter. */
function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;

  const [scheme, value] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || value === undefined) return null;

  return value.trim().length === 0 ? null : value.trim();
}

@Injectable()
export class MuseTenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(MuseTenantMiddleware.name);

  constructor(private readonly tokens: ApiTokenService) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const presented = bearerToken(req);
    if (presented === null) return next();

    const verified = await this.tokens.verify(presented);
    if (verified === null) return next();

    if (req.tenant !== undefined && req.tenant.id !== verified.tenantId) {
      this.logger.warn(
        `Muse token for tenant ${verified.tenantId} presented on host ` +
          `'${req.tenant.domain}' (tenant ${req.tenant.id}). Serving the token's ` +
          `community; check which base URL this integration is configured with.`,
      );
    }

    req.museToken = verified;

    // The token's community, for everything downstream. Nested inside the
    // context TenantMiddleware opened; the innermost wins.
    return runWithTenant(verified.tenantId, () => next());
  }
}
