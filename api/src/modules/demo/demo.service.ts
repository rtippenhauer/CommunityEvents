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
 * How long an unconfirmed request is **kept**, as opposed to how long its link
 * works.
 *
 * Two different questions that used to share one answer. `expiresAt` is when
 * the link stops working and the row stops counting against the caps -- short
 * on purpose, so somebody who never clicks does not hold a slot. But the row
 * was deleted at that same moment, which meant "who asked for a demo and never
 * set it up" was answerable for at most a day, and in practice not at all,
 * since the sweep runs daily and usually found nothing left to look at.
 *
 * Keeping the row for the same week a demo itself lives makes that question
 * answerable on the operator's Communities screen. It costs nothing against the
 * caps -- a lapsed request is already excluded from every count -- and it is
 * bounded rather than indefinite, which matters because the row holds somebody's
 * name, address and IP for a demo that does not exist.
 */
export const DEMO_REQUEST_RETENTION_DAYS = 7;

/**
 * How many live demos one **address** may hold.
 *
 * One, and it is not a second opinion about the per-IP cap -- it is the only
 * cap that survives a client changing networks. A dual-stack visitor arriving
 * over IPv4 once and IPv6 the next presents two addresses with nothing in
 * common, and no amount of normalising joins them (see `normalizeIp`); so does
 * anyone on a phone that drops to cellular. The email address is the one thing
 * they carry between those, so it is what makes the cap bind for an ordinary
 * person rather than only for one who stays on one connection.
 *
 * It is not proof against a determined abuser, who can simply use another
 * address -- the per-IP and pool caps are what bound that. The three answer
 * different failures and all three are cheap.
 */
export const MAX_LIVE_DEMOS_PER_EMAIL = 1;

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

/**
 * The address the per-IP cap counts against -- one bucket per client, not one
 * per connection.
 *
 * Two problems, and they have to be solved together or the cap does not bind:
 *
 * **IPv4-mapped IPv6.** Node reports an IPv4 client on a dual-stack socket as
 * `::ffff:203.0.113.4` and the same client elsewhere as `203.0.113.4`. Stored
 * as-is those are two addresses, and the cap silently doubles for anyone whose
 * requests land on different sockets. Unwrapped to the bare form.
 *
 * **IPv6 privacy extensions.** A modern client does not have *an* IPv6
 * address; it has a rotating supply of them from its /64, changing as often as
 * hourly. Counting the full address means an IPv6 visitor gets a fresh
 * allowance whenever their host portion rolls over -- which is to say the cap
 * does not apply to most home connections at all. So an IPv6 address is
 * bucketed by its **routing prefix** -- the first 64 bits, which is what a
 * customer is actually allocated, rather than the host portion that rotates.
 *
 * That has the side benefit of storing less: the /64 identifies a subscriber
 * line rather than a device, and an abuse counter has no need for the latter.
 *
 * It cannot unify a dual-stack client that arrives over IPv4 one time and IPv6
 * the next -- those genuinely are different addresses with nothing in common.
 * Such a visitor gets two allowances, and the total pool cap is what bounds
 * that, as it bounds spoofing.
 */
export function normalizeIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  const trimmed = ip.trim().toLowerCase();
  if (!trimmed) return undefined;

  // `::ffff:203.0.113.4` is an IPv4 client wearing an IPv6 socket.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(trimmed);
  if (mapped) return mapped[1];

  // No colon at all: IPv4, or something unrecognised we pass through rather
  // than mangle.
  if (!trimmed.includes(':')) return trimmed;

  return ipv6Prefix(trimmed) ?? trimmed;
}

/**
 * The /64 of an IPv6 address, written as `a:b:c:d::`.
 *
 * Expands `::` first: `2600:2b00::1` is four leading groups of
 * `2600, 2b00, 0, 0`, and taking the first four written groups without
 * expanding would read it as `2600, 2b00, 1` and bucket it with something
 * else entirely. Returns null for anything that does not parse, so the caller
 * falls back to the address as given rather than inventing a bucket.
 */
function ipv6Prefix(address: string): string | null {
  const zoneless = address.split('%')[0];
  const halves = zoneless.split('::');
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  if (head.some((g) => !/^[0-9a-f]{0,4}$/.test(g))) return null;
  if (tail.some((g) => !/^[0-9a-f]{0,4}$/.test(g))) return null;

  let groups: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  } else {
    if (head.length !== 8) return null;
    groups = head;
  }

  const prefix = groups.slice(0, 4).map((g) => (g === '' ? '0' : g.replace(/^0+(?=.)/, '')));
  return `${prefix.join(':')}::`;
}

export interface DemoRequestResult {
  /** Always the same message, whatever happened. See requestDemo. */
  message: string;
}

/**
 * Somebody who asked for a demo and has not set it up (v2-14).
 *
 * The operator's view of a request that has produced no community. Confirmed
 * requests are deliberately absent: the community they made is already on the
 * Communities list beside them, and listing both would show the same demo
 * twice under two names.
 */
export interface PendingDemoRequest {
  id: number;
  fullName: string;
  email: string;
  /**
   * The bucket the caps counted, not necessarily the address as it arrived --
   * an IPv6 client is stored as its /64. Shown because it is the answer to
   * "why was this person refused", which is the commonest question this screen
   * gets opened for.
   */
  ipAddress: string | null;
  requestedAt: Date;
  expiresAt: Date;
  /**
   * `awaiting` while the link still works, `lapsed` once it does not.
   *
   * The distinction is the whole point of the screen. An awaiting request is
   * holding a slot and may still become a demo; a lapsed one is a person who
   * asked and never came back, which is the thing worth knowing and the thing
   * that used to be deleted before anyone could see it.
   */
  status: 'awaiting' | 'lapsed';
}

/** How much of the demo pool is spoken for, and by what. */
export interface DemoCapacity {
  live: number;
  awaiting: number;
  max: number;
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
    const clientIp = normalizeIp(ipAddress);

    const allowed = await this.withinCaps(clientIp, lowerEmail);
    if (!allowed.ok) {
      this.logger.warn(`Demo request from ${clientIp ?? 'unknown IP'} refused: ${allowed.reason}`);
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
            ipAddress: clientIp,
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

    const allowed = await this.withinCaps(
      normalizeIp(request.ipAddress ?? undefined),
      request.email,
      request.id,
    );
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

    const url = `${this.scheme()}//${domain}`;

    // The second mail: where the demo actually lives.
    //
    // Not a duplicate of the confirmation. That one proved the address; this
    // one is the only durable copy of a hostname nobody can reconstruct --
    // `demo-a1b2c3d4.<domain>` is deliberately unguessable so that nobody
    // treats it as their own permanent site, and the price of that is that
    // losing the tab loses the demo. The page says "bookmark this"; this makes
    // it true whether or not they did.
    //
    // Awaited but never allowed to fail the request: the community exists and
    // the page is about to show the link. A mail outage should not turn a
    // successful provision into an error.
    try {
      await this.sendReadyNotice(request.email, request.fullName, url, expiresAt);
    } catch (err) {
      this.logger.warn(
        `Demo ${domain} was created but its "ready" email failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return { url, expiresAt };
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

    // Kept past their expiry, then deleted. The link stopped working at
    // `expiresAt` and the row stopped counting against the caps there too; what
    // the extra week buys is the operator being able to see that somebody asked
    // and never followed through, which is otherwise invisible. Bounded rather
    // than indefinite: the row holds a name, an address and an IP belonging to
    // a demo that does not exist.
    const retentionCutoff = new Date(
      now.getTime() - DEMO_REQUEST_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
    const { count: requests } = await runUnscoped(
      'clearing demo requests that were never confirmed',
      async () =>
        await this.prisma.demo_requests.deleteMany({
          where: { createdTenantId: null, createdAt: { lt: retentionCutoff } },
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
   * Who asked for a demo and never set it up, for the system admin (v2-14).
   *
   * The gap this closes: a request that is never confirmed creates nothing, so
   * it appears nowhere -- not in the Communities list, which shows tenants, and
   * not in the mail log, which shows a confirmation that went out and stops
   * there. The operator could see that four slots were gone and had no way to
   * see who was holding them, or whether anybody had tried and failed.
   *
   * Confirmed requests are excluded because the community they produced is
   * already on the list beside this one. Ordered newest first: the recent ones
   * are the ones someone might still act on.
   */
  async listPendingRequests(): Promise<{
    capacity: DemoCapacity;
    requests: PendingDemoRequest[];
  }> {
    const now = new Date();

    const [live, rows] = await runUnscoped(
      'the system admin reviewing demo requests across the deployment',
      async () =>
        await Promise.all([
          this.prisma.tenants.count({ where: { isDemo: true } }),
          this.prisma.demo_requests.findMany({
            where: { createdTenantId: null },
            orderBy: { createdAt: 'desc' },
            // Never the password hash or the token. The hash is nobody's
            // business, and the token is a live credential -- serving it would
            // let anyone who could read this screen set up somebody else's demo
            // with a password only that person knows.
            select: {
              id: true,
              fullName: true,
              email: true,
              ipAddress: true,
              createdAt: true,
              expiresAt: true,
            },
          }),
        ]),
    );

    const requests: PendingDemoRequest[] = rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      ipAddress: r.ipAddress,
      requestedAt: r.createdAt,
      expiresAt: r.expiresAt,
      status: r.expiresAt.getTime() > now.getTime() ? 'awaiting' : 'lapsed',
    }));

    return {
      capacity: {
        live,
        awaiting: requests.filter((r) => r.status === 'awaiting').length,
        max: MAX_LIVE_DEMOS,
      },
      requests,
    };
  }

  /**
   * Withdraws one unconfirmed request, freeing its slot (v2-14).
   *
   * The action that makes the list above worth more than a report. A pool full
   * of requests nobody clicked closes the demo to everyone for a day, and the
   * sweep that would clear them runs once a day -- so without this the
   * operator's only recourse is to wait, or to edit the database.
   *
   * **Refuses a confirmed request** rather than deleting it. The row is what
   * ties an address and an IP to a live demo, so removing it would hand that
   * person's caps back while their community still stands; deleting the
   * community is the way to do that, and it takes this row with it by cascade.
   */
  async cancelRequest(id: number): Promise<PendingDemoRequest> {
    const row = await runUnscoped(
      'the system admin withdrawing a demo request',
      async () => await this.prisma.demo_requests.findUnique({ where: { id } }),
    );
    if (!row) throw new NotFoundException('No such demo request');
    if (row.createdTenantId) {
      throw new BadRequestException(
        'That request already created a demo. Delete the community instead.',
      );
    }

    await runUnscoped(
      'the system admin withdrawing a demo request',
      async () => await this.prisma.demo_requests.delete({ where: { id } }),
    );
    this.logger.log(`Demo request from ${row.email} withdrawn by the system admin.`);

    return {
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      ipAddress: row.ipAddress,
      requestedAt: row.createdAt,
      expiresAt: row.expiresAt,
      status: row.expiresAt.getTime() > Date.now() ? 'awaiting' : 'lapsed',
    };
  }

  /**
   * All three caps, checked together because all three refuse the same way.
   *
   * The per-IP and per-email caps count *live demos and unlapsed requests*
   * rather than tenants, which is why `demo_requests` keeps its row after
   * confirmation: it is the only link between a person and the communities they
   * have standing.
   *
   * **The email cap is what makes the per-IP cap survive a change of network.**
   * An IPv4 and an IPv6 address for the same client have nothing in common, so
   * a dual-stack visitor -- or anyone whose phone drops to cellular -- presents
   * as two clients and gets two allowances. The address they type is the one
   * identifier that crosses that, so it carries a cap of its own.
   *
   * It also closes a race the old placement could not. The email was checked in
   * `requestDemo` only, and only against demos that already existed, so two
   * requests from one address could both sit pending and both confirm. Checked
   * here it is re-asked at confirmation like the other two, counting pending
   * requests as well as live demos.
   */
  private async withinCaps(
    ipAddress: string | undefined,
    email: string,
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

    // "Standing" is the same shape for both of the next two counts: a request
    // that produced a demo, or one whose link has not lapsed yet. A lapsed
    // request counts for nothing, which is what lets somebody who never clicked
    // ask again.
    const standing = {
      OR: [{ createdTenantId: { not: null } }, { expiresAt: { gt: now } }],
      ...notThisOne,
    };

    const fromThisEmail = await runUnscoped(
      'counting this address against the per-email cap',
      async () =>
        await this.prisma.demo_requests.count({ where: { email, ...standing } }),
    );
    if (fromThisEmail >= MAX_LIVE_DEMOS_PER_EMAIL) return { ok: false, reason: 'email_limit' };

    if (ipAddress) {
      const fromThisIp = await runUnscoped(
        'counting this address against the per-IP cap',
        async () =>
          await this.prisma.demo_requests.count({ where: { ipAddress, ...standing } }),
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

  /**
   * "Your demo is ready, here is where it lives."
   *
   * Sent as the deployment from the ROOT tenant's context, exactly like the
   * confirmation -- and necessarily so, because the community it is about
   * cannot send mail at all (`EmailService.sendingIsBlocked`). A demo mailing
   * its own owner would be the one exception to that rule, and carving out an
   * exception is worse than sending as the platform, which is honestly who is
   * writing.
   */
  private async sendReadyNotice(
    email: string,
    fullName: string,
    url: string,
    expiresAt: Date,
  ): Promise<void> {
    const root = await runUnscoped(
      'finding the root tenant to send as',
      async () =>
        await this.prisma.tenants.findFirst({
          where: { rootMarker: true },
          select: { id: true },
        }),
    );
    if (!root) {
      this.logger.error('No root tenant, so no demo ready notice can be sent.');
      return;
    }

    const when = expiresAt.toUTCString().slice(0, 16);

    await runWithTenant(root.id, async () => {
      await this.email.sendNow({
        toEmail: email,
        toName: fullName,
        subject: 'Your {{brand}} demo is ready',
        htmlBody:
          `<p>Hello ${escapeHtml(fullName)},</p>` +
          `<p>Your demo community is set up and waiting:</p>` +
          `<p><a href="${url}">${escapeHtml(url)}</a></p>` +
          `<p>Sign in with this email address and the password you chose. Keep this message — ` +
          `the address is generated, so it is not one you will remember.</p>` +
          `<p>It is deleted on <strong>${when}</strong>, along with everything in it, and sooner ` +
          `if nobody signs in for a couple of days.</p>`,
        textBody:
          `Hello ${fullName},

` +
          `Your demo community is set up and waiting:

${url}

` +
          `Sign in with this email address and the password you chose. Keep this message — the ` +
          `address is generated, so it is not one you will remember.

` +
          `It is deleted on ${when}, along with everything in it, and sooner if nobody signs in ` +
          `for a couple of days.
`,
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
