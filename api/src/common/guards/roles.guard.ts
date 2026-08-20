import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

/**
 * Roles that a given role satisfies in addition to itself.
 *
 * The guard was a flat allowlist until v2-6 introduced `system_admin`, and the
 * alternative to this table was adding `SYSTEM_ADMIN` to every one of the ~50
 * existing `@Roles(ADMIN)` sites. That was rejected because its failure mode is
 * silent and permanent: a new admin route that forgets the extra entry simply
 * 403s the system admin, and nothing anywhere fails to build or test.
 *
 * Kept deliberately small and one level deep. It is not a general privilege
 * lattice -- `admin` still does not imply `moderator`, because the existing
 * routes that both may reach already list both, and inventing an ordering now
 * would silently widen every one of them.
 *
 * `system_admin` implying `admin` is safe to state unconditionally here because
 * the role only exists on the root tenant: SystemAdminGuard enforces the
 * `req.tenant.isRoot` half, and admin.service.setRole refuses to assign the role
 * anywhere else. This table answers "what may this role do", not "where".
 */
const ROLE_IMPLIES: Partial<Record<UserRole, readonly UserRole[]>> = {
  [UserRole.SYSTEM_ADMIN]: [UserRole.ADMIN],
};

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest<{ user: User }>();
    if (requiredRoles.includes(user.role)) return true;

    const implied = ROLE_IMPLIES[user.role];
    return implied !== undefined && implied.some((role) => requiredRoles.includes(role));
  }
}
