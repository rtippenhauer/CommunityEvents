import { UserRole } from '../../database/enums';

/**
 * Role-set membership tests, for the checks that happen *inside* handlers.
 *
 * RolesGuard understands that `system_admin` implies `admin` (see the hierarchy
 * table there), but the guard only decides whether a request reaches a handler.
 * Roughly two dozen places then ask the question again in code -- "is this
 * caller privileged enough to see moderator fields", "is this target an admin I
 * must refuse to ban" -- and a bare `role === UserRole.ADMIN` there does not
 * know about the hierarchy at all.
 *
 * That split is the whole hazard of adding a role that implies another one: the
 * route opens, the handler runs, and then some inner comparison silently treats
 * the system admin as an ordinary member. It shows up as missing fields or a
 * wrong permission rather than as an error. These helpers exist so the question
 * is asked in one vocabulary everywhere, and so adding a future role means
 * editing these lists rather than finding every comparison again.
 */

/** Roles carrying full administrative rights over a tenant. */
export const ADMIN_ROLES: readonly UserRole[] = [UserRole.ADMIN, UserRole.SYSTEM_ADMIN];

/** Roles that see moderator/admin-only fields and bypass member-level limits. */
export const ELEVATED_ROLES: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.SYSTEM_ADMIN,
  UserRole.MODERATOR,
];

/** Admin or system admin. Use for "is this caller an admin" and "is this target one". */
export function hasAdminRights(role: UserRole | undefined | null): boolean {
  return role !== undefined && role !== null && ADMIN_ROLES.includes(role);
}

/** Admin, system admin or moderator. */
export function isElevatedRole(role: UserRole | undefined | null): boolean {
  return role !== undefined && role !== null && ELEVATED_ROLES.includes(role);
}
