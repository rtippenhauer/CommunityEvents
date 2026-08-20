import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { users as User } from '@prisma/client';
import { UserRole } from '../../database/enums';
import type { TenantContext } from '../tenant/tenant-context';
import { SystemAdminGuard } from './system-admin.guard';

const rootTenant = { id: 1, slug: 'root', domain: 'x.test', isRoot: true, status: 'active' } as TenantContext;
const otherTenant = { ...rootTenant, id: 2, slug: 'other', isRoot: false } as TenantContext;

function contextFor(
  role: UserRole | undefined,
  tenant: TenantContext | undefined,
): ExecutionContext {
  const user = role === undefined ? undefined : ({ role } as User);
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, tenant }) }),
  } as unknown as ExecutionContext;
}

describe('SystemAdminGuard', () => {
  const guard = new SystemAdminGuard();

  it('admits a system admin on the root tenant', () => {
    expect(guard.canActivate(contextFor(UserRole.SYSTEM_ADMIN, rootTenant))).toBe(true);
  });

  /**
   * The reason the guard checks the host at all. A system_admin row appearing on
   * an ordinary tenant -- bad migration, hand-edited database, future bug in
   * setRole -- would otherwise hand that community's operator the whole
   * registry. The host is not something a tenant admin can change.
   */
  it('refuses a system admin whose request resolved to a non-root tenant', () => {
    expect(() => guard.canActivate(contextFor(UserRole.SYSTEM_ADMIN, otherTenant))).toThrow(
      ForbiddenException,
    );
  });

  it('refuses an ordinary admin on the root tenant', () => {
    expect(() => guard.canActivate(contextFor(UserRole.ADMIN, rootTenant))).toThrow(
      ForbiddenException,
    );
  });

  it('refuses when no tenant was resolved at all', () => {
    expect(() => guard.canActivate(contextFor(UserRole.SYSTEM_ADMIN, undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('refuses an unauthenticated request', () => {
    expect(() => guard.canActivate(contextFor(undefined, rootTenant))).toThrow(ForbiddenException);
  });

  it('gives the same message whichever half failed', () => {
    const messages = [
      contextFor(UserRole.SYSTEM_ADMIN, otherTenant),
      contextFor(UserRole.ADMIN, rootTenant),
    ].map((ctx) => {
      try {
        guard.canActivate(ctx);
        return 'no throw';
      } catch (err) {
        return (err as ForbiddenException).message;
      }
    });

    expect(messages[0]).toBe(messages[1]);
  });
});
