import { ForbiddenException } from '@nestjs/common';

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
