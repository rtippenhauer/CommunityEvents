import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { users as User } from '@prisma/client';
import { UserRole } from '../../database/enums';
import { RolesGuard } from './roles.guard';

/**
 * The hierarchy is the only interesting thing here, and it is worth pinning
 * because it was introduced to avoid editing ~50 @Roles(ADMIN) sites: if it
 * silently stopped working, every one of those routes would start 403ing the
 * system admin and nothing else would fail.
 */
function contextFor(role: UserRole): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { role } as User }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardRequiring(roles: UserRole[] | undefined): RolesGuard {
  const reflector = { getAllAndOverride: () => roles } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard', () => {
  it('allows a role that is listed outright', () => {
    expect(guardRequiring([UserRole.ADMIN]).canActivate(contextFor(UserRole.ADMIN))).toBe(true);
  });

  it('refuses a role that is not listed', () => {
    expect(guardRequiring([UserRole.ADMIN]).canActivate(contextFor(UserRole.MEMBER))).toBe(false);
  });

  it('allows any role when the route declares none', () => {
    expect(guardRequiring(undefined).canActivate(contextFor(UserRole.MEMBER))).toBe(true);
  });

  describe('system_admin hierarchy', () => {
    it('satisfies @Roles(ADMIN) without ADMIN being listed', () => {
      expect(
        guardRequiring([UserRole.ADMIN]).canActivate(contextFor(UserRole.SYSTEM_ADMIN)),
      ).toBe(true);
    });

    it('satisfies a route listing ADMIN alongside others', () => {
      expect(
        guardRequiring([UserRole.ADMIN, UserRole.MODERATOR]).canActivate(
          contextFor(UserRole.SYSTEM_ADMIN),
        ),
      ).toBe(true);
    });

    it('does not satisfy a route that lists only MODERATOR', () => {
      // The table is one level deep on purpose: system_admin implies admin, and
      // admin does NOT imply moderator. A route reachable by moderators only is
      // one the system admin has no claim on either.
      expect(
        guardRequiring([UserRole.MODERATOR]).canActivate(contextFor(UserRole.SYSTEM_ADMIN)),
      ).toBe(false);
    });

    it('does not work in reverse — an admin is not a system admin', () => {
      expect(
        guardRequiring([UserRole.SYSTEM_ADMIN]).canActivate(contextFor(UserRole.ADMIN)),
      ).toBe(false);
    });
  });

  describe('disabled', () => {
    it.each([
      UserRole.ADMIN,
      UserRole.SYSTEM_ADMIN,
      UserRole.MODERATOR,
      UserRole.MEMBER,
      UserRole.AUTOMATION,
      UserRole.NON_VALIDATED,
    ])('is refused by a route requiring %s', (required) => {
      expect(guardRequiring([required]).canActivate(contextFor(UserRole.DISABLED))).toBe(false);
    });
  });
});
