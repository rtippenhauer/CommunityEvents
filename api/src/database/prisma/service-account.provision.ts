import { Prisma, PrismaClient } from '@prisma/client';
import {
  AUTOMATION_ACCOUNT_EMAIL,
  AUTOMATION_ACCOUNT_NAME,
} from '../../common/utils/service-account.util';
import { isStageDeployment } from '../../common/config/deployment.util';

/**
 * Accepts either a client or a transaction client, so a caller inside
 * `$transaction` can pass its `tx` and have the account committed with
 * everything else it is creating.
 */
export type SqlExecutor = Prisma.TransactionClient | PrismaClient;

/**
 * Creates the one service account a tenant owns (see service-account.util.ts).
 *
 * Its own module, with no side effects at import time, because both `bootstrap.ts`
 * and `provision-tenant.ts` need it and both are *scripts* that call `main()` at
 * the bottom of the file. Importing the function from bootstrap ran bootstrap --
 * provision-tenant died on a missing INSTANCE_CITY_NAME it has no business
 * needing. Anything shared between two entry-point scripts has to live outside
 * both of them.
 *
 * Raw SQL rather than a Prisma create for the same reason the rest of bootstrap
 * is: `ON DUPLICATE KEY UPDATE` has no Prisma equivalent that leaves every other
 * column alone, and re-running provisioning must not fail on an account that
 * already exists.
 *
 * `password_hash` is NULL by design -- nothing signs in as this account with a
 * password, so there is no credential here to leak.
 *
 * Only called for tenants that should have one -- see tenantGetsServiceAccount.
 *
 * The account carries `automation` wherever it exists, root or not (Rob,
 * 2026-08-17).
 * It used to be `disabled` outside the root tenant, on the reasoning that those
 * communities have no automation to run and an `automation` role there would be
 * an escalation path via admin.service.setRole, which permits promoting an
 * automation account to admin.
 *
 * That reasoning was half right and produced a worse outcome. An account named
 * "Claude Automation" showing the role `disabled` reads as something broken, on
 * the one screen an operator checks when a community looks wrong. And the
 * escalation it guarded against was never reachable: this account has a NULL
 * password_hash, no OAuth link, and automationLogin admits the root tenant's
 * account only -- so promoting a non-root one to admin produces an admin nobody
 * can authenticate as.
 *
 * The protection is kept, just moved somewhere it holds regardless of role:
 * setRole now refuses to change any non-root service account's role at all,
 * rather than relying on it happening to sit at `disabled`.
 *
 * `users.city_id` is NOT NULL and `cities` is global, so any city serves; the
 * field is meaningless for an account that never attends anything.
 */
/**
 * Whether a tenant should get a service account at all.
 *
 * The root tenant always does: automationLogin admits it on any deployment, and
 * the release-notes importer attributes to it.
 *
 * Every other community gets one only on a stage deployment, because that is
 * the only place anything can use it (Rob, 2026-08-18). The account used to be
 * created everywhere, on the stated reasoning that the deployment needed
 * something to attribute its own writes to inside that community. That was
 * simply wrong: `audit_log.user_id` is nullable and no code path looks up a
 * non-root service account. It was an account nobody could sign in to, that
 * nothing referenced, sitting in every customer community -- so in production
 * it is not created at all.
 *
 * The stage/production difference is deliberate and is exactly the testing
 * affordance: on stage, automation signs in to each community to exercise
 * tenant isolation as a real member. In production that capability does not
 * exist, rather than existing behind a promise to disable it later.
 */
export function tenantGetsServiceAccount(isRoot: boolean): boolean {
  return isRoot || isStageDeployment();
}

export async function createServiceAccount(
  tx: SqlExecutor,
  tenantId: number,
  cityId: number,
): Promise<void> {
  await tx.$executeRawUnsafe(
    `INSERT INTO users
       (tenant_id, full_name, email, email_status, email_verified_at,
        password_hash, city_id, role, status, is_service_account)
     VALUES (?, ?, ?, 'active', NOW(), NULL, ?, ?, 'active', 1)
     ON DUPLICATE KEY UPDATE is_service_account = 1`,
    tenantId,
    AUTOMATION_ACCOUNT_NAME,
    AUTOMATION_ACCOUNT_EMAIL,
    cityId,
    'automation',
  );
}
