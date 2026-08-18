import { Prisma, PrismaClient } from '@prisma/client';
import {
  AUTOMATION_ACCOUNT_EMAIL,
  AUTOMATION_ACCOUNT_NAME,
} from '../../common/utils/service-account.util';

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
 * Every tenant's account carries `automation`, root or not (Rob, 2026-08-17).
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
