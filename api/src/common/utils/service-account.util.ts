import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ADMIN_ROLES } from './roles.util';

/**
 * Service accounts: the one non-human account each tenant owns.
 *
 * Created with the tenant (bootstrap.ts for the root, provision-tenant.ts for
 * every other) and never by a signup, they exist so the deployment has a user
 * row to attribute its own writes to -- release notes on the root tenant, and
 * on other tenants simply an owner for anything the system creates on their
 * behalf. Nothing in the application offers a way to make or unmake one.
 *
 * They are protected in two different senses, which are easy to conflate:
 *
 *  - **Not removable.** Ban, force-ban, admin delete, self-delete and the
 *    inactivity sweep all refuse them. The sweep is the one that actually would
 *    have fired: it soft-deletes any ACTIVE account whose `lastLoginAt` is over
 *    120 days old and hard-deletes it 30 days later, and a service account
 *    either never logs in or does so rarely, so it drifts into that window on
 *    its own. Losing the row would orphan every audit and release-notes FK
 *    pointing at it.
 *  - **Not shown.** Excluded from the member directory and the leaderboard, the
 *    same way admins are excluded from the leaderboard -- they are not members
 *    of the community and would be a permanent zero-point row in it.
 *
 * Both checks key on `users.is_service_account`, never on the role or the
 * automation email address. The role is deliberately mutable (the root tenant's
 * account gets flipped to admin and back for testing) and the email is branding
 * that v2-9 rewrites; the column is set once at creation and nothing changes it.
 */
/**
 * The service account's fixed identity.
 *
 * Still a constant rather than a lookup because bootstrap has to create the row
 * with *some* address, and it must be reproducible across re-runs. Nothing
 * *identifies* a service account by it any more, though -- that is
 * `is_service_account` -- so this is only used where a row is created or where
 * one specific well-known account is meant. The `.internal` TLD is reserved and
 * unroutable, so the address can never receive mail.
 *
 * v2-9 rebrands this. Grep for the constant, not the string.
 */
export const AUTOMATION_ACCOUNT_EMAIL = 'automation@dinnerbears.internal';
export const AUTOMATION_ACCOUNT_NAME = 'Claude Automation';

export function assertNotServiceAccount(
  target: { isServiceAccount: boolean },
  action: string,
): void {
  if (target.isServiceAccount) {
    throw new ForbiddenException(`Cannot ${action} the automation service account.`);
  }
}

/**
 * Prisma `where` fragment excluding service accounts.
 *
 * Spread into a filter rather than written out at each site so that the six
 * places that need it cannot drift -- and so that grepping this symbol finds
 * every query that deliberately skips them.
 */
export const EXCLUDE_SERVICE_ACCOUNTS = { isServiceAccount: false } as const;

/** The same exclusion for the raw SQL the tenant extension cannot reach. */
export const EXCLUDE_SERVICE_ACCOUNTS_SQL = 'u.is_service_account = 0';

/**
 * Prisma `where` fragment restricting a sweep to accounts it may remove.
 *
 * Every *interactive* delete path already refuses admins and service accounts:
 * ban, force-ban, admin delete and self-delete each check. The scheduled sweeps
 * did not, which meant the one actor that could remove an admin was the one
 * nobody was watching -- `inactivityCheck` soft-deletes any ACTIVE account whose
 * `lastLoginAt` is over 120 days old and hard-deletes it 30 days later, with no
 * confirmation and no reviewer.
 *
 * That is a plausible way to lose the only admin of a quiet community: an
 * operator who runs their community by email for four months and never signs in
 * comes back to a deleted account. Agreed with Rob 2026-08-15 that automated
 * deletion should never reach an admin, a system admin or a service account --
 * only a human choosing to, and those paths refuse them too.
 *
 * Deliberately scoped to the *deletion* stages. The 60- and 90-day
 * re-engagement stages still include admins, because nudging an idle admin is
 * the point; it is only removing them that must not happen on a timer. Service
 * accounts are excluded from those as well, since they are not people to email.
 */
export const AUTO_DELETE_ELIGIBLE: Prisma.usersWhereInput = {
  isServiceAccount: false,
  // Copied out of the readonly ADMIN_ROLES: Prisma's generated filter types want
  // a mutable array, and a shared `as const` tuple will not assign to one.
  role: { notIn: [...ADMIN_ROLES] },
};
