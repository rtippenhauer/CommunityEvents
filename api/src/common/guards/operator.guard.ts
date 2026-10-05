import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';

/**
 * Whoever operates the **deployment**: the system admin, or the automation
 * account acting on their behalf.
 *
 * ## Why this is not just `@Roles(SYSTEM_ADMIN, AUTOMATION)`
 *
 * Because the automation account's role is **deliberately mutable**. It gets
 * flipped to `admin` and back so it can browse role-gated pages, and CLAUDE.md
 * says in two places that guards must key on `users.is_service_account` and
 * *never* on the role for exactly this reason -- the role is the one property
 * here guaranteed to change. `AuthService.automationLogin` already does it
 * correctly.
 *
 * v2-32 got this wrong twice before it was right, and the second time reached
 * stage: the account was sitting at `admin`, so a `@Roles(SYSTEM_ADMIN,
 * AUTOMATION)` check refused it at the moment automation was being used. A role
 * check on this account fails precisely when it matters.
 *
 * ## Two independent halves
 *
 * The **root tenant**, which a community's own admin cannot reach, *and* either
 * the `system_admin` role or the service-account column. A root-tenant admin who
 * is neither is refused -- deliberately, per Rob (2026-10-04): "only system
 * admin can interact with it". That is narrower than `ReleasesAdminController`,
 * which does admit a root-tenant admin, and the difference is intentional: this
 * board carries other communities' reports.
 *
 * Stack it **after** `RolesGuard`, which stays as the coarse filter; this is the
 * precise one. Used with `JwtAuthGuard`, which populates `req.user`.
 */
@Injectable()
export class OperatorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: User }>();
    const { user, tenant } = request;

    const isOperator =
      user?.role === UserRole.SYSTEM_ADMIN || user?.isServiceAccount === true;

    // One message for both failures, matching SystemAdminGuard: telling a
    // community's admin that they have the right role but the wrong host
    // describes the operator surface to somebody who cannot use it.
    if (!user || tenant?.isRoot !== true || !isOperator) {
      throw new ForbiddenException('Not available here.');
    }
    return true;
  }
}
