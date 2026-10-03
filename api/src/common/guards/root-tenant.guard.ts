import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Requires the request to have resolved to the **root tenant**, whatever role
 * the caller holds.
 *
 * The "where", separated from the "what". `RolesGuard` answers what a role may
 * do and deliberately says nothing about which community it may do it in, which
 * is correct for the ~50 routes that act inside the caller's own community and
 * wrong for the few that act on something deployment-wide.
 *
 * **Why this exists rather than `SystemAdminGuard`.** That guard requires the
 * `system_admin` role *and* the root tenant, which is right for the tenant
 * registry. It is too strict for the release-note system, where the automation
 * account legitimately creates drafts and unpublishes under the `automation`
 * role (see `ReleasesAdminController`, and `AuthService.automationLogin` for why
 * that account exists). Pairing this with the existing `@Roles(...)` keeps that
 * policy exactly as written while closing the half that was missing: the
 * community the request arrived on.
 *
 * Used with, not instead of, `JwtAuthGuard` and `RolesGuard`.
 *
 * The message deliberately does not say what the caller is missing. Telling an
 * ordinary community's admin that this exists and answers somewhere else
 * describes the operator surface to somebody who cannot use it.
 */
@Injectable()
export class RootTenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.tenant?.isRoot !== true) {
      throw new ForbiddenException('Not available here.');
    }
    return true;
  }
}
