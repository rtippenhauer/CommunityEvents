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
 * How long a confirmed demo lives. A confirmation link is acted on in minutes
 * or not at all, so an unconfirmed request lapses far sooner.
 */
export const DEMO_LIFETIME_DAYS = 7;
export const DEMO_REQUEST_LIFETIME_HOURS = 24;

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

    const allowed = await this.withinCaps(request.ipAddress ?? undefined);
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
  async deleteExpired(now = new Date()): Promise<{ demos: number; requests: number }> {
    const expired = await runUnscoped('finding demos past their expiry', async () =>
      await this.prisma.tenants.findMany({
        where: { isDemo: true, demoExpiresAt: { lt: now } },
        select: { id: true, domain: true, isRoot: true },
      }),
    );

    let demos = 0;
    for (const demo of expired) {
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
        this.logger.log(`Deleted expired demo ${demo.domain}`);
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
    return { demos, requests };
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
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const [live, pending] = await runUnscoped('counting demos against the caps', async () =>
      await Promise.all([
        this.prisma.tenants.count({ where: { isDemo: true } }),
        this.prisma.demo_requests.count({
          where: { createdTenantId: null, expiresAt: { gt: new Date() } },
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
              OR: [{ createdTenantId: { not: null } }, { expiresAt: { gt: new Date() } }],
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
