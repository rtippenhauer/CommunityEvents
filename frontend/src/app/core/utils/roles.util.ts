/**
 * Role-set membership tests, mirroring `api/src/common/utils/roles.util.ts`.
 *
 * The API gained a `system_admin` role that implies `admin` (v2-6). On the
 * server that hierarchy lives in RolesGuard; the browser has no equivalent, so
 * every `role === 'admin'` check here would quietly treat the system admin as
 * an ordinary member -- hiding admin controls from the one account that has the
 * most rights, and 403ing them only after they found another way to the route.
 *
 * The two copies are kept deliberately parallel: a role added on the server has
 * to be classified in both files. There is no shared type between them (the
 * frontend types `role` as a plain string off the wire), so a mismatch shows up
 * as behaviour rather than as a compile error -- which is why the sets are
 * written out here rather than inferred from anything.
 */

export type UserRoleName =
  | 'non_validated'
  | 'member'
  | 'moderator'
  | 'admin'
  | 'system_admin'
  | 'automation'
  | 'disabled';

/** Roles carrying full administrative rights over a tenant. */
const ADMIN_ROLES: readonly string[] = ['admin', 'system_admin'];

/** Roles that see moderator/admin-only controls. */
const ELEVATED_ROLES: readonly string[] = ['admin', 'system_admin', 'moderator'];

/** Admin or system admin. */
export function hasAdminRights(role: string | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

/** Admin, system admin or moderator. */
export function isElevatedRole(role: string | null | undefined): boolean {
  return !!role && ELEVATED_ROLES.includes(role);
}

/**
 * The deployment operator specifically, not merely an admin.
 *
 * Only gates the tenant-management UI. The API checks this again *and* checks
 * that the request reached the root host, which the browser cannot verify --
 * so this is presentation only, and a wrong answer here is a 403, not a leak.
 */
export function isSystemAdmin(role: string | null | undefined): boolean {
  return role === 'system_admin';
}
