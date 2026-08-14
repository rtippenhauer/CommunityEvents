import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenantResolutionService } from './tenant-resolution.service';

/**
 * Paths that answer regardless of which host asked (REQ-TENANT-01.2 scopes
 * tenant resolution to the application, not to liveness).
 *
 * Health has to keep answering on an unrecognized host, because the two
 * failures this middleware reports — "wrong domain" and "no tenants at all" —
 * are exactly the ones an operator needs the health endpoint to describe. A
 * health check that 404s on a misconfigured deployment tells you nothing about
 * why. It reports the tenant outcome in its body instead; see HealthService.
 *
 * Matched against the full path including the `api/v1` global prefix. The
 * exemption lives here rather than in MiddlewareConsumer.exclude() on purpose:
 * exclude() paths are matched by path-to-regexp against a path whose relation
 * to the global prefix has changed between Nest majors, and getting it subtly
 * wrong fails open — every route exempt, no tenant scoping, no test failure
 * unless one is written for exactly that. A string compare cannot fail open.
 */
const UNSCOPED_PATHS = ['/api/v1/health'];

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(private readonly tenants: TenantResolutionService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (isUnscoped(requestPath(req))) return next();

    const resolution = await this.tenants.resolve(req.headers.host);

    switch (resolution.outcome) {
      case 'resolved':
        req.tenant = resolution.tenant;
        return next();

      case 'suspended':
        // The tenant exists and the deployment is fine — this is an
        // administrative state, and 503 says "come back later" where 404 would
        // say "this was never here".
        return respond(
          req,
          res,
          HttpStatus.SERVICE_UNAVAILABLE,
          'This community is temporarily unavailable.',
          'TENANT_SUSPENDED',
        );

      case 'not-configured':
        // Migrated and seeded but never bootstrapped: there is no tenant to
        // resolve against, so 404 would blame the caller for the operator's
        // unfinished install. TenantResolutionService has already logged it.
        return respond(
          req,
          res,
          HttpStatus.SERVICE_UNAVAILABLE,
          'This deployment has not been set up yet.',
          'TENANT_NOT_CONFIGURED',
        );

      case 'unrecognized':
        return respond(
          req,
          res,
          HttpStatus.NOT_FOUND,
          'No community is configured for this address.',
          'TENANT_NOT_FOUND',
        );
    }
  }
}

/**
 * The path this request actually asked for.
 *
 * NOT req.path: Nest mounts module middleware at a path, and Express strips a
 * mount path from req.url/req.path inside the handler — under
 * forRoutes('{*splat}') every request arrives here reporting its path as "/".
 * req.originalUrl is the only field that survives mounting intact. This was a
 * live bug, not a hypothetical: the health exemption below silently matched
 * nothing until an integration test asked for /api/v1/health on an
 * unrecognized host.
 */
function requestPath(req: Request): string {
  return (req.originalUrl || req.url || '').split('?')[0];
}

function isUnscoped(path: string): boolean {
  // Normalise a trailing slash so "/api/v1/health/" is not a way around the
  // list — in either direction.
  const normalized = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  return UNSCOPED_PATHS.includes(normalized);
}

/**
 * Writes the same body shape GlobalExceptionFilter produces.
 *
 * The filter is not reused by throwing here, because a filter registered with
 * useGlobalFilters() wraps route handlers — an exception thrown in middleware
 * unwinds to Express's own error handler instead, which honours the status but
 * replaces the body with its stock HTML. The `reason` is what tells the
 * frontend to show the "not set up" page rather than a generic error, so the
 * body has to be ours. Writing it directly also behaves identically under
 * Supertest and in the container, with no dependency on filter ordering.
 */
function respond(
  req: Request,
  res: Response,
  status: number,
  message: string,
  reason: string,
): void {
  res.status(status).json({
    statusCode: status,
    message,
    reason,
    timestamp: new Date().toISOString(),
    path: requestPath(req),
  });
}
