import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { runUnscoped } from '../../common/tenant/tenant-store';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import { PrismaService } from '../../database/prisma/prisma.service';
import { resetDemoTenant } from '../../database/prisma/demo-seed';

/**
 * Returns the demo community to its seeded state, nightly (v2-14).
 *
 * The reset is not housekeeping — it is what makes the demo's open door safe to
 * leave open. Anyone who signs up there is an admin of it, so anyone can delete
 * its events, rename it, or fill it with nonsense; without a scheduled reset the
 * demo is only useful until the first visitor who wants to find out what the
 * delete button does.
 *
 * **3am is already taken twice** (hard-delete and the Brevo token sweep), so this
 * runs at 4am rather than adding a third job to the same minute. Nightly is the
 * target the item set, with weekly named as the floor; there is no setting for
 * it, because a deployment that wants a different cadence wants it in one place
 * and this is that place.
 *
 * The clock is the container's, which is UTC on this deployment — so "nightly"
 * means 4am UTC, not 4am where the operator lives. That is deliberate rather
 * than overlooked: unlike the email quota day (`EMAIL_QUOTA_TIMEZONE`, v2-9),
 * nothing about a reset is read off a calendar by a human, and nobody is
 * counting demo resets per day.
 */
@Injectable()
export class DemoResetTask {
  private readonly logger = new Logger(DemoResetTask.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantResolution: TenantResolutionService,
  ) {}

  /**
   * The waiver wraps this method rather than a private delegate so the e2e suite
   * can call `runDemoReset()` directly, outside any request — the same shape
   * `HardDeleteTask` uses, and for the same reason.
   *
   * `runUnscoped` is right for the whole job here, which is unusual: v2-9's rule
   * is that a sweep composing per-tenant *content* must re-enter
   * `runWithTenant`, because `app_config` is scoped and branding read under a
   * waiver returns whichever tenant the engine reached first. Nothing here reads
   * branding or renders anything — every write names its `tenantId` explicitly
   * (see `demo-seed.ts`), and re-entering a tenant context would in fact be
   * wrong, since the wipe has to delete rows the extension would be filtering.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  runDemoReset(): Promise<void> {
    return runUnscoped('the nightly demo reset rewrites one community wholesale', () =>
      this.resetEveryDemo(),
    );
  }

  private async resetEveryDemo(): Promise<void> {
    // Plural because the column permits it, not because a deployment is expected
    // to run more than one. A `findFirst` here would silently stop resetting the
    // second demo somebody created, and an un-reset demo is an open registration
    // door onto data that accumulates forever.
    const demos = await this.prisma.tenants.findMany({
      where: { isDemo: true },
      select: { id: true, domain: true, isRoot: true },
    });

    if (demos.length === 0) return;

    for (const demo of demos) {
      // `chk_tenant_demo_not_root` makes this unrepresentable in the database, so
      // reaching it means the constraint is missing — a database restored from a
      // pre-v2-14 dump, say. Refusing loudly is the only safe response: the
      // alternative is erasing the deployment's own community on a timer.
      if (demo.isRoot) {
        this.logger.error(
          `Tenant ${demo.domain} is flagged both root and demo, which the database ` +
            `is supposed to forbid. Refusing to reset it — check chk_tenant_demo_not_root.`,
        );
        continue;
      }

      try {
        const summary = await resetDemoTenant(this.prisma, demo.id);
        this.logger.log(
          `Demo ${demo.domain} reset: removed ${JSON.stringify(summary.wiped)}; ` +
            `seeded ${summary.members} members, ${summary.locations} locations, ` +
            `${summary.pastEvents} past and ${summary.upcomingEvents} upcoming events.`,
        );
      } catch (err) {
        // Caught per demo rather than letting the job die: with more than one,
        // the second should still be reset. Logged at error because a demo that
        // stops resetting looks fine from outside — it just quietly becomes a
        // permanent community with open admin registration.
        this.logger.error(
          `Demo ${demo.domain} failed to reset: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // The seed rewrites branding, so a cached resolution for these hosts is now
    // describing rows that no longer exist.
    this.tenantResolution.clearCache();
  }
}
