import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma/prisma.service';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import { runUnscoped, runWithTenant } from '../../common/tenant/tenant-store';
import { purgeTenantRows } from '../../common/tenant/tenant-purge';
import { seedDemoTenant } from '../../database/prisma/demo-seed';
import { resolveRootTenantDomain } from '../../common/utils/tenant-domain.util';
import { EmailStatus, UserRole, UserStatus } from '../../database/enums';
import { EmailService } from '../email/email.service';

/** Matches AuthService.register, so this hash verifies like any other. */
const BCRYPT_ROUNDS = 12;

/**
 * How long a confirmed demo lives.
 *
 * **Seven days is a consequence of the demo being one visitor's own, not a
 * number picked on its own** (decided with Rob 2026-09-18). Retention here
 * trades against blast radius: on a shared demo anyone can delete the events or
 * rename the community, so whatever one visitor breaks is what every later
 * visitor sees, and the cadence has to be a single day to bound it. Per-visitor
 * isolation removes that entirely -- nobody else can see your demo, so nobody
 * else is harmed by what you do to it -- which is what buys the week.
 *
 * So the two move together. Anything that reintroduces sharing has to bring the
 * lifetime back down to a day with it; a shared demo kept for a week is the one
 * combination that was explicitly rejected.
 *
 * A confirmation link, by contrast, is acted on in minutes or not at all, so an
 * unconfirmed request lapses far sooner.
 */
export const DEMO_LIFETIME_DAYS = 7;
export const DEMO_REQUEST_LIFETIME_HOURS = 24;

/**
 * How long a demo may sit untouched before its slot is taken back.
 *
 * The caps protect against abuse; this protects against indifference, which is
 * the commoner failure. Most people who ask for a demo look at it for ten
 * minutes and never return, and with ten slots and a seven-day lifetime it
 * takes only ten such visitors to close the demo to everyone else for a week.
 * Reclaiming the abandoned ones is what keeps the pool available without
 * shortening the week for anybody actually using theirs.
 *
 * Idle is measured from the last **login**, falling back to when the demo was
 * created -- so a demo whose owner has not signed in yet is judged on its age,
 * not treated as infinitely idle. The sweep runs daily, so in practice a demo
 * is reclaimed somewhere between 48 and 72 hours of silence; the guarantee is
 * "not before 48 hours", which is the direction that matters.
 */
export const DEMO_IDLE_HOURS = 48;

/**
 * The caps, set with Rob 2026-09-18.
 *
 * Deliberately small. Ten live demos is not a capacity limit -- each is a few
 * dozen rows -- it is a blast-radius limit on a door that is open to anyone.
 */
export const MAX_LIVE_DEMOS = 10;
export const MAX_LIVE_DEMOS_PER_IP = 2;

export interface DemoRequestResult {
  /** Always the same message, whatever happened. See requestDemo. */
  message: string;
}

/**
 * Ephemeral per-visitor demo communities (v2-14).
 *
 * A visitor asks for a demo, confirms by email, and gets their own community at
 * a generated host with themselves as its admin. It is deleted seven days later.
 *
 * **Per-visitor rather than one shared demo, for privacy.** An admin can see
 * every user's email address, their linked OAuth addresses, the address each
 * invite was bound to, and can search on them -- so a shared demo where signing
 * up granted admin would hand each visitor a searchable directory of the last
 * visitors' real addresses.
 *
 * That shape also removes a privilege escalation rather than guarding one.
 * There is no "registering here makes you an admin" rule in any auth path: the
 * requester becomes the first admin at creation time, exactly as
 * `TenantsAdminService.create` does for any other community.
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tenantResolution: TenantResolutionService,
    private readonly email: EmailService,
  ) {}

  /**
   * Step one: record the request and mail a confirmation link.
   *
   * **No tenant is created here.** Confirmation gates creation so that
   * unconfirmed requests cannot hold slots against the caps -- ten abandoned
   * requests would otherwise close the demo to everyone for a week.
   *
   * The reply is the same sentence whether the request was recorded, refused
   * for a cap, or landed on an address that already has a demo. The caps are
   * the thing worth not leaking: a distinguishable "too many demos" tells an
   * attacker exactly when the pool is full, and a distinguishable "you already
   * have one" turns this into an oracle for whether an address has been used
   * here. The caller learns what happened from their inbox or not at all.
   */
  async requestDemo(
    fullName: string,
    email: string,
    password: string,
    ipAddress: string | undefined,
  ): Promise<DemoRequestResult> {
    const reply: DemoRequestResult = {
      message: 'Check your email for a link to your demo community.',
    };
    const lowerEmail = email.toLowerCase().trim();

    const allowed = await this.withinCaps(ipAddress);
    if (!allowed.ok) {
      this.logger.warn(`Demo request from ${ipAddress ?? 'unknown IP'} refused: ${allowed.reason}`);
      return reply;
    }

    // `demo_requests` is global, so every read and write of it is waived
    // explicitly: there is no tenant to scope it to, which is the whole reason
    // the model is global.
    const existing = await runUnscoped(
      'demo requests belong to no tenant',
      async () =>
        await this.prisma.demo_requests.findFirst({
          where: { email: lowerEmail, createdTenantId: { not: null } },
        }),
    );
    if (existing) {
      this.logger.warn(`Demo request for ${lowerEmail} refused: that address already has a demo.`);
      return reply;
    }

    const token = randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const expiresAt = new Date(Date.now() + DEMO_REQUEST_LIFETIME_HOURS * 60 * 60 * 1000);

    await runUnscoped(
      'demo requests belong to no tenant',
      async () =>
        await this.prisma.demo_requests.create({
          data: {
            email: lowerEmail,
            fullName: fullName.trim(),
            passwordHash,
            token,
            ipAddress,
            expiresAt,
          },
        }),
    );

    await this.sendConfirmation(lowerEmail, fullName.trim(), token);
    return reply;
  }

  /**
   * Step two: create the community and hand back where it lives.
   *
   * The caps are re-checked here rather than trusted from step one. Requests
   * are cheap and confirmations arrive whenever the person opens their mail, so
   * twenty outstanding requests could otherwise confirm in the same minute and
   * every one of them would have passed a cap check made when the pool was
   * empty.
   */
  async confirmDemo(token: string): Promise<{ url: string; expiresAt: Date }> {
    const request = await runUnscoped(
      'demo requests belong to no tenant',
      async () => await this.prisma.demo_requests.findUnique({ where: { token } }),
    );

    if (!request) throw new NotFoundException({ message: 'Unknown link', reason: 'invalid_token' });
    if (request.createdTenantId) {
      throw new BadRequestException({ message: 'Already used', reason: 'already_confirmed' });
    }
    if (request.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({ message: 'Link expired', reason: 'expired' });
    }

    const allowed = await this.withinCaps(request.ipAddress ?? undefined, request.id);
    if (!allowed.ok) {
      throw new BadRequestException({ message: 'No demo slots free', reason: allowed.reason });
    }

    const domain = this.generateDomain();
    const expiresAt = new Date(Date.now() + DEMO_LIFETIME_DAYS * 24 * 60 * 60 * 1000);

    const tenant = await runUnscoped('creating a demo community', async () =>
      await this.prisma.tenants.create({
        data: {
          slug: domain.split('.')[0],
          domain,
          status: 'active',
          isDemo: true,
          demoExpiresAt: expiresAt,
          // Never the root tenant; chk_tenant_demo_not_root rejects the
          // combination in the database regardless.
          isRoot: false,
          rootMarker: null,
        },
      }),
    );

    const cityId = await this.firstCityId();

    // The requester, as the community's first admin. Created verified: they
    // just proved the address by following the link that got them here, which
    // is the same evidence email verification collects.
    await runUnscoped("creating the demo's first admin", async () =>
      await this.prisma.users.create({
        data: {
          tenantId: tenant.id,
          cityId,
          fullName: request.fullName,
          email: request.email,
          passwordHash: request.passwordHash,
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          emailStatus: EmailStatus.ACTIVE,
          emailVerifiedAt: new Date(),
        },
      }),
    );

    await runUnscoped(
      'seeding the demo community',
      async () => await seedDemoTenant(this.prisma, tenant.id),
    );

    await runUnscoped(
      'linking the request to the demo it created',
      async () =>
        await this.prisma.demo_requests.update({
          where: { id: request.id },
          data: { createdTenantId: tenant.id, confirmedAt: new Date() },
        }),
    );

    this.tenantResolution.clearCache();
    this.logger.log(`Demo ${domain} created for ${request.email}, expires ${expiresAt.toISOString()}`);

    return { url: `${this.scheme()}//${domain}`, expiresAt };
  }

  /**
   * Deletes every demo whose time is up, and every unconfirmed request that
   * lapsed.
   *
   * Reuses `purgeTenantRows`, which is what makes this safe on a demo whose
   * visitor invited somebody: several foreign keys onto `users` are restrictive,
   * and a redeemed invite used to break a straight walk of the model list.
   */
  async deleteExpired(
    now = new Date(),
  ): Promise<{ demos: number; idle: number; requests: number }> {
    const expired = await runUnscoped('finding demos past their expiry', async () =>
      await this.prisma.tenants.findMany({
        where: { isDemo: true, demoExpiresAt: { lt: now } },
        select: { id: true, domain: true, isRoot: true },
      }),
    );

    const idle = await this.findIdleDemos(now, new Set(expired.map((d) => d.id)));
    const doomed = [...expired, ...idle];

    let demos = 0;
    for (const demo of doomed) {
      // Unreachable while chk_tenant_demo_not_root exists. If it is ever
      // missing -- a database restored from a pre-v2-14 dump -- refusing is the
      // only safe answer: the alternative is deleting the deployment's own
      // community on a timer.
      if (demo.isRoot) {
        this.logger.error(
          `Tenant ${demo.domain} is flagged both root and demo, which the database should ` +
            `forbid. Refusing to delete it -- check chk_tenant_demo_not_root.`,
        );
        continue;
      }
      try {
        await runUnscoped(`deleting expired demo ${demo.domain}`, async () => {
          await this.prisma.$transaction(
            async (tx) => {
              await purgeTenantRows(tx, demo.id);
              // The demo_requests row goes with it by ON DELETE CASCADE, which
              // is what stops an address and an IP outliving the community they
              // created.
              await (tx as unknown as {
                tenants: { delete(args: { where: { id: number } }): Promise<unknown> };
              }).tenants.delete({ where: { id: demo.id } });
            },
            { timeout: 120_000, maxWait: 15_000 },
          );
        });
        demos += 1;
        this.logger.log(`Deleted demo ${demo.domain}`);
      } catch (err) {
        // Per demo, so one failure does not strand the rest.
        this.logger.error(
          `Failed to delete expired demo ${demo.domain}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const { count: requests } = await runUnscoped(
      'clearing lapsed demo requests',
      async () =>
        await this.prisma.demo_requests.deleteMany({
          where: { createdTenantId: null, expiresAt: { lt: now } },
        }),
    );

    if (demos > 0 || requests > 0) this.tenantResolution.clearCache();
    // `demos` counts everything deleted; `idle` says how many of those went for
    // want of use rather than age. Separated because they mean different
    // things operationally -- a rising idle count is people trying the product
    // and not coming back, which is worth noticing.
    return { demos, idle: idle.length, requests };
  }

  /**
   * Demos nobody has signed into for `DEMO_IDLE_HOURS`.
   *
   * Activity is the most recent login by a real person in that community. The
   * seeded members never log in, so their rows contribute nothing; what moves
   * this is the visitor whose demo it is.
   *
   * A demo with no login at all is judged on its **creation time** rather than
   * treated as idle forever -- otherwise a demo confirmed two minutes ago, whose
   * owner is still reading the welcome page, would be reclaimed by the next
   * sweep before they ever signed in.
   *
   * `alreadyDoomed` keeps a demo that is both expired and idle from being
   * deleted twice, which would log a spurious failure on the second attempt.
   */
  private async findIdleDemos(
    now: Date,
    alreadyDoomed: Set<number>,
  ): Promise<{ id: number; domain: string; isRoot: boolean }[]> {
    const cutoff = new Date(now.getTime() - DEMO_IDLE_HOURS * 60 * 60 * 1000);

    const [live, lastLogins] = await runUnscoped(
      'finding idle demos across every community',
      async () =>
        await Promise.all([
          this.prisma.tenants.findMany({
            where: { isDemo: true },
            select: { id: true, domain: true, isRoot: true, createdAt: true },
          }),
          // One grouped query rather than one per demo. Service accounts are
          // excluded for the same reason the member directory excludes them:
          // they are not a person whose visit means anything.
          this.prisma.users.groupBy({
            by: ['tenantId'],
            _max: { lastLoginAt: true },
            where: { isServiceAccount: false },
          }),
        ]),
    );

    const lastLoginByTenant = new Map(
      lastLogins.map((row) => [row.tenantId, row._max.lastLoginAt]),
    );

    return live
      .filter((demo) => {
        if (alreadyDoomed.has(demo.id)) return false;
        const lastSeen = lastLoginByTenant.get(demo.id) ?? demo.createdAt;
        return lastSeen.getTime() < cutoff.getTime();
      })
      .map(({ id, domain, isRoot }) => ({ id, domain, isRoot }));
  }

  /**
   * Whether this community is a demo. Used by the controller to gate the
   * self-delete route before it reaches the service, which checks again.
   */
  async isDemoHost(tenantId: number): Promise<boolean> {
    return this.tenantResolution.isDemoTenant(tenantId);
  }

  /**
   * Deletes one demo on the spot, at its own admin's request (v2-14).
   *
   * The owner's counterpart to the expiry sweep. Without it somebody who is
   * finished with their demo has no way to say so: their data sits for the rest
   * of the week, and their slot stays spent against the per-IP cap, so they
   * cannot start a fresh one either.
   *
   * **The caller's own tenant, never an id they name.** `tenantId` comes from
   * the resolved host, so this cannot be pointed at another community even by
   * an admin who knows another demo's id -- which matters because every demo
   * visitor is an admin of something. The controller additionally requires
   * `is_demo`, so an admin of a real community cannot reach it at all.
   */
  async deleteOwnDemo(tenantId: number): Promise<void> {
    const tenant = await runUnscoped(
      'confirming the community asking to be deleted is a demo',
      async () =>
        await this.prisma.tenants.findUnique({
          where: { id: tenantId },
          select: { id: true, domain: true, isDemo: true, isRoot: true },
        }),
    );

    if (!tenant) throw new NotFoundException('No such community');
    // Both re-checked here rather than trusted from the controller: this is the
    // one path where a request deletes the very community serving it, and the
    // guard that got us here lives in a different file.
    if (!tenant.isDemo || tenant.isRoot) {
      throw new BadRequestException('Only a demo community can be deleted this way.');
    }

    await runUnscoped(`a demo admin deleting ${tenant.domain}`, async () => {
      await this.prisma.$transaction(
        async (tx) => {
          await purgeTenantRows(tx, tenant.id);
          await (tx as unknown as {
            tenants: { delete(args: { where: { id: number } }): Promise<unknown> };
          }).tenants.delete({ where: { id: tenant.id } });
        },
        { timeout: 120_000, maxWait: 15_000 },
      );
    });

    this.tenantResolution.clearCache();
    this.logger.log(`Demo ${tenant.domain} deleted early by its own admin.`);
  }

  /**
   * Both caps, checked together because both refuse the same way.
   *
   * The per-IP cap counts *live demos* rather than requests, which is why
   * `demo_requests` keeps its row after confirmation: the IP is the only link
   * between a person and the communities they have standing.
   */
  private async withinCaps(
    ipAddress: string | undefined,
    excludeRequestId?: number,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    // `excludeRequestId` is the request being confirmed, and leaving it out is
    // the whole correctness of this at confirmation time.
    //
    // The question both caps ask is "would letting this through put us over?",
    // so what has to be counted is everything OTHER than the thing being
    // decided. At request time there is nothing to exclude -- the row does not
    // exist yet and we are about to add one. At confirmation the row already
    // exists as pending and is merely changing state, so counting it is
    // counting it twice.
    //
    // Found on stage the first time Rob confirmed a second demo: with a cap of
    // two per IP, his one live demo plus the pending row being confirmed made
    // two, and the confirmation refused itself. The effective caps were
    // MAX - 1 at confirmation -- one demo per IP, nine in the pool.
    const notThisOne = excludeRequestId ? { id: { not: excludeRequestId } } : {};
    const now = new Date();

    const [live, pending] = await runUnscoped('counting demos against the caps', async () =>
      await Promise.all([
        this.prisma.tenants.count({ where: { isDemo: true } }),
        this.prisma.demo_requests.count({
          where: { createdTenantId: null, expiresAt: { gt: now }, ...notThisOne },
        }),
      ]),
    );

    // Pending requests count toward the total. They are each a demo that is one
    // click from existing, so ignoring them lets twenty people confirm into ten
    // slots.
    if (live + pending >= MAX_LIVE_DEMOS) return { ok: false, reason: 'pool_full' };

    if (ipAddress) {
      const fromThisIp = await runUnscoped(
        'counting this address against the per-IP cap',
        async () =>
          await this.prisma.demo_requests.count({
            where: {
              ipAddress,
              OR: [{ createdTenantId: { not: null } }, { expiresAt: { gt: now } }],
              ...notThisOne,
            },
          }),
      );
      if (fromThisIp >= MAX_LIVE_DEMOS_PER_IP) return { ok: false, reason: 'ip_limit' };
    }

    return { ok: true };
  }

  /**
   * A generated host, never one the visitor chooses.
   *
   * Chosen names get treated as property -- somebody would set up
   * `smithfamily.` and be rightly annoyed when it vanished on day seven. Hex
   * reads as disposable, which is the honest signal for something that is.
   *
   * `demo-<hex>` prefixed to the deployment's own domain, so it is a **single
   * label** under it: on production that means the existing Universal SSL
   * wildcard already covers it and the record can stay proxied, where
   * `<hex>.demo.<domain>` would be two levels deep and covered by neither.
   * Being a subdomain of the deployment also makes `isOnDeploymentDomain` true,
   * which matters less here than elsewhere -- a demo may not send mail at all --
   * but keeps it consistent with every other community on this deployment.
   */
  private generateDomain(): string {
    const deployment = resolveRootTenantDomain(process.env);
    return `demo-${randomBytes(4).toString('hex')}.${deployment}`;
  }

  private scheme(): string {
    const appUrl = this.config.get<string>('APP_URL', 'https://localhost');
    try {
      return new URL(appUrl).protocol;
    } catch {
      return 'https:';
    }
  }

  private async firstCityId(): Promise<number> {
    const city = await this.prisma.cities.findFirst({
      where: { isActive: true },
      orderBy: { id: 'asc' },
    });
    if (!city) throw new BadRequestException('This deployment has no active city configured.');
    return city.id;
  }

  /**
   * The confirmation link, sent as the **deployment**, not as the demo.
   *
   * Composed inside the root tenant's context deliberately. `app_config` is
   * scoped, so branding read under a waiver returns whichever tenant the engine
   * reached first (v2-9's rule); and the demo this will create does not exist
   * yet, nor could it send anything if it did. This is the platform writing to
   * somebody who asked it for a demo.
   */
  private async sendConfirmation(email: string, fullName: string, token: string): Promise<void> {
    const root = await runUnscoped(
      'finding the root tenant to send as',
      async () =>
        await this.prisma.tenants.findFirst({
          where: { rootMarker: true },
          select: { id: true },
        }),
    );
    if (!root) {
      this.logger.error('No root tenant, so no demo confirmation can be sent.');
      return;
    }

    const base = await this.tenantResolution.baseUrlFor(root.id);
    const link = `${base}/demo/confirm?token=${encodeURIComponent(token)}`;

    await runWithTenant(root.id, async () => {
      await this.email.sendNow({
        toEmail: email,
        toName: fullName,
        subject: 'Your {{brand}} demo',
        htmlBody:
          `<p>Hello ${escapeHtml(fullName)},</p>` +
          `<p>Here is the link to set up your demo community. It works once, and within ` +
          `${DEMO_REQUEST_LIFETIME_HOURS} hours.</p>` +
          `<p><a href="${link}">Set up my demo</a></p>` +
          `<p>Your demo is your own — nobody else can see it — and it is deleted ` +
          `${DEMO_LIFETIME_DAYS} days after you create it. Please don't keep anything there ` +
          `you would mind losing.</p>`,
        textBody:
          `Hello ${fullName},\n\n` +
          `Here is the link to set up your demo community. It works once, and within ` +
          `${DEMO_REQUEST_LIFETIME_HOURS} hours:\n\n${link}\n\n` +
          `Your demo is your own and is deleted ${DEMO_LIFETIME_DAYS} days after you create it.\n`,
      });
    });
  }
}

/** The name is the visitor's own text and goes into an HTML body. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
