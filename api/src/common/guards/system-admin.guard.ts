import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

/**
 * Gate for the tenant-management API (REQ-TENANT-01.7).
 *
 * Requires two independent things, and the second is the point: the caller must
 * hold `system_admin`, **and** the request must have resolved to the root
 * tenant. Either alone is not enough.
 *
 * Checking the host as well as the role matters because these routes are the
 * one place in the application that deliberately reads and writes across every
 * tenant. A role check on its own would mean that if a `system_admin` row ever
 * appeared on an ordinary tenant -- a bad migration, a hand-edited database, a
 * future bug in setRole -- that tenant's operator would immediately be able to
 * enumerate and edit every other community on the deployment. The host is not
 * something a tenant's own admin can change, so requiring it keeps the blast
 * radius of a mis-assigned role to zero.
 *
 * Used with, not instead of, JwtAuthGuard: it assumes `req.user` is populated.
 */
@Injectable()
export class SystemAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: User }>();
    const { user, tenant } = request;

    // Deliberately one message for both failures. Telling a tenant admin that
    // they have the right role but the wrong host, or vice versa, describes the
    // shape of the system-admin surface to someone who cannot use it.
    if (!user || user.role !== UserRole.SYSTEM_ADMIN || tenant?.isRoot !== true) {
      throw new ForbiddenException('System administration is not available here.');
    }

    return true;
  }
}
