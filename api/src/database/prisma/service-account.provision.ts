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
 * The root tenant's account carries `automation`, which AuthService.automationLogin
 * requires. Every other tenant's carries `disabled`, which satisfies no @Roles()
 * at all: those communities have no automation to run, and an `automation` role
 * there would be an escalation path, since admin.service.setRole deliberately
 * permits promoting an automation account to admin.
 *
 * `users.city_id` is NOT NULL and `cities` is global, so any city serves; the
 * field is meaningless for an account that never attends anything.
 */
export async function createServiceAccount(
  tx: SqlExecutor,
  tenantId: number,
  cityId: number,
  isRoot: boolean,
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
    isRoot ? 'automation' : 'disabled',
  );
}
