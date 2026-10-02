import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import {
  DemoService,
  DEMO_IDLE_HOURS,
  DEMO_REQUEST_RETENTION_DAYS,
  MAX_LIVE_DEMOS,
  MAX_LIVE_DEMOS_PER_IP,
} from '../src/modules/demo/demo.service';
import { EmailService } from '../src/modules/email/email.service';
import { BrevoService } from '../src/modules/email/brevo.service';
import { TenantsAdminService } from '../src/modules/system/tenants-admin.service';
import { UserRole } from '../src/database/enums';
import { createTestApp, truncateAllTables, resetThrottler, TEST_TENANT_DOMAIN } from './utils/test-app';
import { seedCity } from './utils/seed';
import { TEST_TENANT_ID } from './setup-env';

const unscoped = <T>(reason: string, fn: () => Promise<T>): Promise<T> =>
  runUnscoped(reason, async () => await fn());

/**
 * The Definition of Done for v2-14, asserted end to end.
 *
 * The demo is the only place an anonymous caller causes a tenant to exist, so
 * the assertions that matter most are the ones about what it must NOT do: no
 * tenant before confirmation, never more than the caps allow, never any mail
 * from inside a demo, and never the root tenant.
 */
describe('Demo tenants (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: TenantResolutionService;
  let demoService: DemoService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenants = app.get(TenantResolutionService);
    demoService = app.get(DemoService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma); // re-seeds the root tenant at TEST_TENANT_ID
    tenants.clearCache();
    resetThrottler(app);
    await unscoped('seeding the shared city fixture', () => seedCity(prisma));
  });

  const askForDemo = (email: string) =>
    request(app.getHttpServer())
      .post('/api/v1/demo/request')
      .set('Host', TEST_TENANT_DOMAIN)
      .send({ fullName: 'Casual Visitor', email, password: 'V1sitorPassw0rd!' });

  const tokenFor = async (email: string): Promise<string> => {
    const row = await unscoped('reading the confirmation token', () =>
      prisma.demo_requests.findFirst({ where: { email } }),
    );
    if (!row) throw new Error(`no demo request for ${email}`);
    return row.token;
  };

  const confirm = (token: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/demo/confirm?token=${encodeURIComponent(token)}`)
      .set('Host', TEST_TENANT_DOMAIN);

  describe('requesting one', () => {
    it('creates no tenant until the link is followed', async () => {
      const res = await askForDemo('visitor@example.test');

      expect(res.status).toBe(202);
      const [pending, tenantCount] = await unscoped('checking nothing was created yet', async () =>
        await Promise.all([
          prisma.demo_requests.count({ where: { createdTenantId: null } }),
          prisma.tenants.count({ where: { isDemo: true } }),
        ]),
      );
      expect(pending).toBe(1);
      expect(tenantCount).toBe(0);
    });

    // The caps are the thing worth not leaking: a distinguishable refusal tells
    // an attacker when the pool is full, and a distinguishable "already have
    // one" turns this into an oracle for whether an address has been used here.
    it('answers identically whether it accepted or refused', async () => {
      const accepted = await askForDemo('first@example.test');
      resetThrottler(app);
      const duplicate = await askForDemo('first@example.test');

      expect(duplicate.status).toBe(accepted.status);
      expect(duplicate.body).toEqual(accepted.body);
    });
  });

  describe('confirming', () => {
    it('creates the community with the requester as its admin, and seeds it', async () => {
      await askForDemo('visitor@example.test');
      const res = await confirm(await tokenFor('visitor@example.test'));

      expect(res.status).toBe(200);
      expect(res.body.url).toMatch(/^https?:\/\/demo-[0-9a-f]{8}\./);

      const demo = await unscoped('inspecting the created demo', () =>
        prisma.tenants.findFirst({ where: { isDemo: true } }),
      );
      expect(demo).not.toBeNull();
      expect(demo!.isRoot).toBe(false);
      expect(demo!.demoExpiresAt).not.toBeNull();

      const [admin, members, events] = await unscoped('checking it was filled', async () =>
        await Promise.all([
          prisma.users.findFirst({ where: { email: 'visitor@example.test' } }),
          prisma.users.count({ where: { tenantId: demo!.id, isServiceAccount: false } }),
          prisma.events.count({ where: { tenantId: demo!.id } }),
        ]),
      );
      expect(admin?.role).toBe(UserRole.ADMIN);
      expect(admin?.tenantId).toBe(demo!.id);
      expect(members).toBeGreaterThan(1);
      expect(events).toBeGreaterThan(0);
    });

    it('refuses a second use of the same link', async () => {
      await askForDemo('visitor@example.test');
      const token = await tokenFor('visitor@example.test');
      await confirm(token);
      const second = await confirm(token);

      expect(second.status).toBe(400);
      expect(second.body.reason).toBe('already_confirmed');
      const count = await unscoped('confirming only one demo exists', () =>
        prisma.tenants.count({ where: { isDemo: true } }),
      );
      expect(count).toBe(1);
    });

    it('refuses an unknown token', async () => {
      const res = await confirm('not-a-real-token');
      expect(res.status).toBe(404);
      expect(res.body.reason).toBe('invalid_token');
    });

    it('refuses an expired request', async () => {
      await askForDemo('visitor@example.test');
      const token = await tokenFor('visitor@example.test');
      await unscoped('ageing the request past its expiry', () =>
        prisma.demo_requests.updateMany({
          where: { token },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      );

      const res = await confirm(token);
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe('expired');
    });
  });

  describe('the caps', () => {
    // Called directly rather than over HTTP: the route throttle would refuse
    // long before the cap did, so going through it would test the throttler.
    it(`stops at ${MAX_LIVE_DEMOS} live demos`, async () => {
      for (let i = 0; i < MAX_LIVE_DEMOS + 2; i += 1) {
        await demoService.requestDemo(
          `visitor${i}@example.test`,
          `visitor${i}@example.test`,
          'V1sitorPassw0rd!',
          `10.0.0.${i}`, // a distinct IP each, so only the total cap can bite
        );
      }

      const pending = await unscoped('counting what was accepted', () =>
        prisma.demo_requests.count(),
      );
      expect(pending).toBe(MAX_LIVE_DEMOS);
    });

    it(`stops at ${MAX_LIVE_DEMOS_PER_IP} per IP`, async () => {
      for (let i = 0; i < MAX_LIVE_DEMOS_PER_IP + 2; i += 1) {
        await demoService.requestDemo(
          `same-ip-${i}@example.test`,
          `same-ip-${i}@example.test`,
          'V1sitorPassw0rd!',
          '10.0.0.99',
        );
      }

      const fromThatIp = await unscoped('counting that address', () =>
        prisma.demo_requests.count({ where: { ipAddress: '10.0.0.99' } }),
      );
      expect(fromThatIp).toBe(MAX_LIVE_DEMOS_PER_IP);
    });

    /**
     * The regression: a cap of N must actually allow N, not N-1.
     *
     * `withinCaps` counted the very request being confirmed -- so with two
     * allowed per IP, the second confirmation saw its own pending row plus the
     * first live demo and refused itself. Found on stage; the effective caps
     * were one demo per IP and nine in the pool.
     */
    it(`allows a full ${MAX_LIVE_DEMOS_PER_IP} demos from one IP`, async () => {
      const ip = '10.0.0.7';
      for (let i = 0; i < MAX_LIVE_DEMOS_PER_IP; i += 1) {
        await demoService.requestDemo(
          `visitor${i}@example.test`,
          `visitor${i}@example.test`,
          'V1sitorPassw0rd!',
          ip,
        );
        const token = await tokenFor(`visitor${i}@example.test`);
        const res = await confirm(token);
        expect(res.status, `confirmation ${i + 1} of ${MAX_LIVE_DEMOS_PER_IP}`).toBe(200);
      }

      expect(
        await unscoped('counting live demos', () =>
          prisma.tenants.count({ where: { isDemo: true } }),
        ),
      ).toBe(MAX_LIVE_DEMOS_PER_IP);
    });

    // And the cap still bites at N+1 -- fixing the off-by-one must not have
    // simply removed the limit.
    it('still refuses one more from that IP', async () => {
      const ip = '10.0.0.8';
      for (let i = 0; i < MAX_LIVE_DEMOS_PER_IP; i += 1) {
        await demoService.requestDemo(`f${i}@example.test`, `f${i}@example.test`, 'V1sitorPassw0rd!', ip);
        await confirm(await tokenFor(`f${i}@example.test`));
      }

      // Refused at request time now, so no row is even written for it.
      await demoService.requestDemo('extra@example.test', 'extra@example.test', 'V1sitorPassw0rd!', ip);
      const extra = await unscoped('looking for a row that should not exist', () =>
        prisma.demo_requests.findFirst({ where: { email: 'extra@example.test' } }),
      );
      expect(extra).toBeNull();
    });

    // The two spellings Node uses for one IPv4 client. Counted separately, the
    // cap silently doubles for anyone whose requests land on different sockets.
    it('treats a mapped and a bare IPv4 address as the same client', async () => {
      await demoService.requestDemo('a@example.test', 'a@example.test', 'V1sitorPassw0rd!', '::ffff:203.0.113.9');
      await demoService.requestDemo('b@example.test', 'b@example.test', 'V1sitorPassw0rd!', '203.0.113.9');
      // A third from the same client, spelled either way, is over the cap.
      await demoService.requestDemo('c@example.test', 'c@example.test', 'V1sitorPassw0rd!', '::ffff:203.0.113.9');

      const rows = await unscoped('counting that client', () =>
        prisma.demo_requests.findMany({ where: { ipAddress: '203.0.113.9' } }),
      );
      expect(rows).toHaveLength(MAX_LIVE_DEMOS_PER_IP);
      // And stored in one spelling, so the cap query can find them.
      expect(
        await unscoped('no mapped spelling survives', () =>
          prisma.demo_requests.count({ where: { ipAddress: '::ffff:203.0.113.9' } }),
        ),
      ).toBe(0);
    });

    // Requests are cheap and confirmations arrive whenever somebody opens their
    // mail, so the cap has to hold at confirmation too -- otherwise a backlog
    // of requests made while the pool was empty all confirm into a full one.
    it('re-checks at confirmation, not only at request', async () => {
      await askForDemo('early@example.test');
      const token = await tokenFor('early@example.test');

      // The pool fills after the request was accepted.
      await unscoped('filling the pool behind their back', async () => {
        for (let i = 0; i < MAX_LIVE_DEMOS; i += 1) {
          await prisma.tenants.create({
            data: {
              slug: `filler-${i}`,
              domain: `filler-${i}.example.test`,
              isDemo: true,
              demoExpiresAt: new Date(Date.now() + 86_400_000),
            },
          });
        }
      });

      const res = await confirm(token);
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe('pool_full');
    });

    /**
     * The per-email cap, which is what makes the per-IP cap survive a change of
     * network.
     *
     * An IPv4 and an IPv6 address for one client have nothing in common, so a
     * dual-stack visitor gets two IP allowances and nothing can join them. The
     * address they type is the one identifier that crosses that.
     */
    describe('per address', () => {
      it('gives one address one demo, however the request arrives', async () => {
        await demoService.requestDemo('Dual Stack', 'dual@example.test', 'V1sitorPassw0rd!', '198.51.100.7');
        await confirm(await tokenFor('dual@example.test'));

        // Same person, same address, an IPv6 connection this time -- a
        // different bucket as far as the IP cap can tell.
        await demoService.requestDemo(
          'Dual Stack',
          'dual@example.test',
          'V1sitorPassw0rd!',
          '2600:2b00:945e:9000:4493:648f:ebe2:248d',
        );

        const rows = await unscoped('counting that address', () =>
          prisma.demo_requests.count({ where: { email: 'dual@example.test' } }),
        );
        expect(rows).toBe(1);
      });

      /**
       * The race the old placement could not close: the email was checked in
       * `requestDemo` only, and only against demos that already existed, so two
       * requests from one address could both sit pending and both confirm.
       */
      it('refuses a second pending request from the same address', async () => {
        await demoService.requestDemo('Eager', 'eager@example.test', 'V1sitorPassw0rd!', '198.51.100.8');
        await demoService.requestDemo('Eager', 'eager@example.test', 'V1sitorPassw0rd!', '198.51.100.9');

        expect(
          await unscoped('counting that address', () =>
            prisma.demo_requests.count({ where: { email: 'eager@example.test' } }),
          ),
        ).toBe(1);
      });

      // Case is not an identity: two spellings of one mailbox must not be two
      // allowances. Requests are stored lower-cased, so the cap query finds
      // them both.
      it('treats two spellings of one address as one', async () => {
        await demoService.requestDemo('Shouty', 'Mixed.Case@Example.Test', 'V1sitorPassw0rd!', '198.51.100.10');
        await demoService.requestDemo('Shouty', 'mixed.case@example.test', 'V1sitorPassw0rd!', '198.51.100.11');

        expect(await unscoped('counting', () => prisma.demo_requests.count())).toBe(1);
      });

      // A request nobody ever confirmed frees the address again: it holds no
      // slot, so refusing them would be punishing somebody for a link they
      // never clicked.
      it('lets an address try again once its link has lapsed', async () => {
        await demoService.requestDemo('Second Thoughts', 'retry@example.test', 'V1sitorPassw0rd!', '198.51.100.12');
        await unscoped('lapsing the link', () =>
          prisma.demo_requests.updateMany({
            where: { createdTenantId: null },
            data: { expiresAt: new Date(Date.now() - 1000) },
          }),
        );

        await demoService.requestDemo('Second Thoughts', 'retry@example.test', 'V1sitorPassw0rd!', '198.51.100.12');

        expect(
          await unscoped('counting', () =>
            prisma.demo_requests.count({
              where: { email: 'retry@example.test', expiresAt: { gt: new Date() } },
            }),
          ),
        ).toBe(1);
      });

      // Re-checked at confirmation like the other two caps, not trusted from
      // request time.
      it('refuses at confirmation if the address gained a demo meanwhile', async () => {
        await demoService.requestDemo('Twice', 'twice@example.test', 'V1sitorPassw0rd!', '198.51.100.13');
        const token = await tokenFor('twice@example.test');

        // A demo appears for that address behind their back -- the shape a
        // second pending request would have had before the cap moved.
        await unscoped('creating a rival demo for the same address', async () => {
          const rival = await prisma.tenants.create({
            data: {
              slug: 'rival',
              domain: 'rival.example.test',
              isDemo: true,
              demoExpiresAt: new Date(Date.now() + 86_400_000),
            },
          });
          await prisma.demo_requests.create({
            data: {
              email: 'twice@example.test',
              fullName: 'Twice',
              passwordHash: 'x',
              token: 'rival-token',
              expiresAt: new Date(Date.now() + 86_400_000),
              createdTenantId: rival.id,
              confirmedAt: new Date(),
            },
          });
        });

        const res = await confirm(token);
        expect(res.status).toBe(400);
        expect(res.body.reason).toBe('email_limit');
      });
    });
  });

  /**
   * Who asked for a demo and never set it up (v2-14).
   *
   * The gap: an unconfirmed request creates nothing, so it appeared on no
   * screen while still holding a slot. The operator could see four slots gone
   * and had no way to see who held them.
   */
  describe('the operator view of pending requests', () => {
    it('lists a request that has not been confirmed', async () => {
      await askForDemo('waiting@example.test');

      const { capacity, requests } = await demoService.listPendingRequests();

      expect(requests).toHaveLength(1);
      expect(requests[0].email).toBe('waiting@example.test');
      expect(requests[0].status).toBe('awaiting');
      expect(capacity).toEqual({ live: 0, awaiting: 1, max: MAX_LIVE_DEMOS });
    });

    // The community it produced is already on the Communities list; showing
    // the request too would show one demo twice under two names.
    it('drops a request once it has become a community', async () => {
      await askForDemo('done@example.test');
      await confirm(await tokenFor('done@example.test'));

      const { capacity, requests } = await demoService.listPendingRequests();

      expect(requests).toHaveLength(0);
      expect(capacity.live).toBe(1);
    });

    /**
     * The token is a live credential: serving it would let anyone who can read
     * this screen set up somebody else's demo, on an address they do not own,
     * with a password only that person knows.
     */
    it('never serves the token or the password hash', async () => {
      await askForDemo('secret@example.test');

      const { requests } = await demoService.listPendingRequests();

      expect(Object.keys(requests[0])).not.toContain('token');
      expect(Object.keys(requests[0])).not.toContain('passwordHash');
      expect(JSON.stringify(requests[0])).not.toContain('V1sitorPassw0rd');
    });

    it('withdraws a request and frees its slot', async () => {
      await askForDemo('withdrawn@example.test');

      await demoService.cancelRequest(
        (await demoService.listPendingRequests()).requests[0].id,
      );

      const after = await demoService.listPendingRequests();
      expect(after.requests).toHaveLength(0);
      expect(after.capacity.awaiting).toBe(0);
      // And the address may ask again, which is the point of freeing it.
      await demoService.requestDemo('Again', 'withdrawn@example.test', 'V1sitorPassw0rd!', '198.51.100.20');
      expect((await demoService.listPendingRequests()).requests).toHaveLength(1);
    });

    /**
     * The row is what ties an address and an IP to a live demo, so deleting it
     * would hand the caps back while the community still stands. Deleting the
     * community is the way to do that, and it takes this row by cascade.
     */
    it('refuses to withdraw a request that already made a demo', async () => {
      await askForDemo('built@example.test');
      await confirm(await tokenFor('built@example.test'));
      const row = await unscoped('finding the confirmed request', () =>
        prisma.demo_requests.findFirst({ where: { createdTenantId: { not: null } } }),
      );

      await expect(demoService.cancelRequest(row!.id)).rejects.toThrow();
      expect(await unscoped('counting', () => prisma.demo_requests.count())).toBe(1);
    });

    // The route is system-admin only: it lists real names, addresses and IPs
    // belonging to people who are not members of any community here.
    it('is refused to an anonymous caller', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/system/demo-requests')
        .set('Host', TEST_TENANT_DOMAIN);

      expect(res.status).toBe(401);
    });
  });

  describe('a demo cannot send mail', () => {
    // Omitting the provider config would NOT have achieved this: v2-9 falls
    // back to the deployment's credentials for a community with none of its
    // own, and a demo is on a subdomain of the deployment. Anyone can create a
    // demo, so that fallback would let anyone mail arbitrary addresses from the
    // operator's sending domain.
    it('refuses to queue anything from inside a demo', async () => {
      await askForDemo('visitor@example.test');
      await confirm(await tokenFor('visitor@example.test'));
      const demo = await unscoped('finding the demo', () =>
        prisma.tenants.findFirstOrThrow({ where: { isDemo: true } }),
      );

      const queued = await runWithTenant(demo.id, async () =>
        await app.get(EmailService).queue({
          toEmail: 'someone@example.test',
          subject: 'Should never be sent',
          htmlBody: '<p>no</p>',
        }),
      );

      expect(queued).toBeNull();
      const rows = await unscoped('confirming nothing was queued', () =>
        prisma.email_queue.count({ where: { tenantId: demo.id } }),
      );
      expect(rows).toBe(0);
    });

    it('still lets an ordinary community send', async () => {
      const queued = await runWithTenant(TEST_TENANT_ID, async () =>
        await app.get(EmailService).queue({
          toEmail: 'someone@example.test',
          subject: 'Ordinary mail',
          htmlBody: '<p>yes</p>',
        }),
      );
      expect(queued).not.toBeNull();
    });
  });

  describe('expiry', () => {
    it('deletes a demo whose time is up and leaves live ones alone', async () => {
      await askForDemo('doomed@example.test');
      await confirm(await tokenFor('doomed@example.test'));
      const demo = await unscoped('finding the demo', () =>
        prisma.tenants.findFirstOrThrow({ where: { isDemo: true } }),
      );
      await unscoped('ageing it past its expiry', () =>
        prisma.tenants.update({
          where: { id: demo.id },
          data: { demoExpiresAt: new Date(Date.now() - 1000) },
        }),
      );

      const result = await demoService.deleteExpired();

      expect(result.demos).toBe(1);
      const [gone, root, request] = await unscoped('checking what survived', async () =>
        await Promise.all([
          prisma.tenants.findUnique({ where: { id: demo.id } }),
          prisma.tenants.findUnique({ where: { id: TEST_TENANT_ID } }),
          prisma.demo_requests.count(),
        ]),
      );
      expect(gone).toBeNull();
      expect(root).not.toBeNull();
      // The request row carries an address and an IP, and goes with the demo it
      // created (ON DELETE CASCADE) rather than outliving it.
      expect(request).toBe(0);
    });

    // A demo whose visitor invited somebody would otherwise trip
    // `users.invite_id -> invites`, which MySQL checks immediately. The same
    // foreign key would have broken deleting any populated community; see
    // tenant-purge.ts.
    it('deletes a demo whose invites were redeemed', async () => {
      await askForDemo('host@example.test');
      await confirm(await tokenFor('host@example.test'));
      const demo = await unscoped('finding the demo', () =>
        prisma.tenants.findFirstOrThrow({ where: { isDemo: true } }),
      );

      await unscoped('the demo admin inviting somebody who joins', async () => {
        const inviter = await prisma.users.findFirstOrThrow({
          where: { email: 'host@example.test' },
        });
        const invite = await prisma.invites.create({
          data: {
            tenantId: demo.id,
            token: 'demo-invite-token',
            type: 'member',
            createdBy: inviter.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        await prisma.users.create({
          data: {
            tenantId: demo.id,
            cityId: 1,
            fullName: 'Invited Person',
            email: 'invited@example.test',
            role: UserRole.MEMBER,
            status: 'active',
            emailStatus: 'active',
            inviteId: invite.id,
            invitedBy: inviter.id,
          },
        });
        await prisma.tenants.update({
          where: { id: demo.id },
          data: { demoExpiresAt: new Date(Date.now() - 1000) },
        });
      });

      const result = await demoService.deleteExpired();
      expect(result.demos).toBe(1);
    });

    /**
     * Idle reclaim. The caps protect against abuse; this protects against
     * indifference, which is commoner -- ten people who look once and never
     * return would otherwise hold the pool shut for a week.
     */
    it(`reclaims a demo nobody has signed into for ${DEMO_IDLE_HOURS} hours`, async () => {
      await askForDemo('abandoner@example.test');
      await confirm(await tokenFor('abandoner@example.test'));
      const demo = await unscoped('finding the demo', () =>
        prisma.tenants.findFirstOrThrow({ where: { isDemo: true } }),
      );
      // Created three days ago and never signed into.
      await unscoped('ageing the demo without any login', () =>
        prisma.tenants.update({
          where: { id: demo.id },
          data: { createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000) },
        }),
      );

      const result = await demoService.deleteExpired();

      expect(result.idle).toBe(1);
      expect(result.demos).toBe(1);
      expect(
        await unscoped('confirming it went', () =>
          prisma.tenants.findUnique({ where: { id: demo.id } }),
        ),
      ).toBeNull();
    });

    // A demo whose owner signed in recently is in use, whatever its age --
    // reclaiming it would delete somebody's work mid-evaluation, which is the
    // exact failure the seven-day lifetime exists to avoid.
    it('leaves a demo alone while somebody is still using it', async () => {
      await askForDemo('active@example.test');
      await confirm(await tokenFor('active@example.test'));
      const demo = await unscoped('finding the demo', () =>
        prisma.tenants.findFirstOrThrow({ where: { isDemo: true } }),
      );
      await unscoped('an old demo whose owner signed in an hour ago', async () => {
        await prisma.tenants.update({
          where: { id: demo.id },
          data: { createdAt: new Date(Date.now() - 72 * 60 * 60 * 1000) },
        });
        await prisma.users.updateMany({
          where: { email: 'active@example.test' },
          data: { lastLoginAt: new Date(Date.now() - 60 * 60 * 1000) },
        });
      });

      const result = await demoService.deleteExpired();

      expect(result.idle).toBe(0);
      expect(
        await unscoped('confirming it survived', () =>
          prisma.tenants.findUnique({ where: { id: demo.id } }),
        ),
      ).not.toBeNull();
    });

    // A demo confirmed minutes ago has no login yet, which must not read as
    // "idle forever" -- its owner is still on the welcome page.
    it('does not reclaim a brand-new demo that has not been signed into yet', async () => {
      await askForDemo('justmade@example.test');
      await confirm(await tokenFor('justmade@example.test'));

      const result = await demoService.deleteExpired();

      expect(result.idle).toBe(0);
      expect(
        await unscoped('counting demos', () => prisma.tenants.count({ where: { isDemo: true } })),
      ).toBe(1);
    });

    /**
     * A lapsed request stops holding a slot at `expiresAt` but is KEPT, so the
     * operator can see that somebody asked and never followed through. Deleting
     * it at expiry -- which is what this used to do -- made that unanswerable:
     * the sweep runs daily and the link lives a day, so in practice there was
     * never anything left to look at.
     */
    it('keeps a lapsed request, but stops it holding a slot', async () => {
      await askForDemo('abandoned@example.test');
      await unscoped('lapsing the link', () =>
        prisma.demo_requests.updateMany({
          where: { createdTenantId: null },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      );

      const result = await demoService.deleteExpired();

      expect(result.requests).toBe(0);
      expect(await unscoped('counting', () => prisma.demo_requests.count())).toBe(1);

      // Still visible to the operator, and marked as what it is.
      const { capacity, requests } = await demoService.listPendingRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].status).toBe('lapsed');
      // And counted against nothing: the slot is genuinely free again.
      expect(capacity.awaiting).toBe(0);
    });

    it(`deletes an unconfirmed request after ${DEMO_REQUEST_RETENTION_DAYS} days`, async () => {
      await askForDemo('longgone@example.test');
      await unscoped('ageing the request past its retention', () =>
        prisma.demo_requests.updateMany({
          where: { createdTenantId: null },
          data: {
            createdAt: new Date(
              Date.now() - (DEMO_REQUEST_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000,
            ),
            expiresAt: new Date(Date.now() - 1000),
          },
        }),
      );

      const result = await demoService.deleteExpired();

      expect(result.requests).toBe(1);
      expect(await unscoped('counting', () => prisma.demo_requests.count())).toBe(0);
    });

    // The retention sweep must never touch a request that produced a live
    // demo: that row is what ties an address and an IP to the community, and
    // removing it hands the caps back while the demo still stands.
    it('leaves a confirmed request alone however old it is', async () => {
      await askForDemo('settled@example.test');
      await confirm(await tokenFor('settled@example.test'));
      await unscoped('ageing it well past retention', () =>
        prisma.demo_requests.updateMany({
          where: { createdTenantId: { not: null } },
          data: { createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
        }),
      );

      const result = await demoService.deleteExpired();

      expect(result.requests).toBe(0);
      expect(await unscoped('counting', () => prisma.demo_requests.count())).toBe(1);
    });
  });

  /**
   * Two emails, and they do different jobs: the first proves the address, the
   * second is the only durable copy of a hostname nobody can reconstruct.
   */
  describe('the "your demo is ready" email', () => {
    it('is sent, and carries the demo URL', async () => {
      await askForDemo('visitor@example.test');
      const before = await unscoped('counting mail before', () => prisma.email_queue.count());

      const res = await confirm(await tokenFor('visitor@example.test'));
      const url = res.body.url as string;

      const mail = await unscoped('reading the mail log', () =>
        prisma.email_queue.findMany({ orderBy: { id: 'desc' } }),
      );
      expect(mail.length).toBeGreaterThan(before);

      const ready = mail.find((m) => m.subject.includes('ready'));
      expect(ready, 'no "ready" email was sent').toBeTruthy();
      expect(ready!.toEmail).toBe('visitor@example.test');
      expect(`${ready!.htmlBody}${ready!.textBody}`).toContain(url);
    });

    // It is about a community that cannot send mail, so it must be sent as the
    // platform from the root tenant -- not from the demo, which EmailService
    // refuses outright.
    it('is sent by the root tenant, not by the demo', async () => {
      await askForDemo('visitor@example.test');
      await confirm(await tokenFor('visitor@example.test'));

      const ready = await unscoped('finding the ready mail', () =>
        prisma.email_queue.findFirst({ where: { subject: { contains: 'ready' } } }),
      );
      expect(ready?.tenantId).toBe(TEST_TENANT_ID);
    });

    // The community exists and the page is about to show the link, so a mail
    // failure must not turn a successful provision into an error.
    it('does not fail the provision when the mail cannot be sent', async () => {
      const brevo = app.get(BrevoService);
      const original = (brevo as unknown as { send: unknown }).send;
      (brevo as unknown as { send: () => Promise<void> }).send = async () => {
        throw new Error('provider down');
      };

      await askForDemo('unlucky@example.test');
      const res = await confirm(await tokenFor('unlucky@example.test'));

      expect(res.status).toBe(200);
      expect(
        await unscoped('the demo still exists', () =>
          prisma.tenants.count({ where: { isDemo: true } }),
        ),
      ).toBe(1);

      (brevo as unknown as { send: unknown }).send = original;
    });
  });

  describe('the standing notice', () => {
    it('announces the demo and its expiry in the branding payload', async () => {
      await askForDemo('visitor@example.test');
      const created = await confirm(await tokenFor('visitor@example.test'));
      const host = new URL(created.body.url as string).host;

      const demoBranding = await request(app.getHttpServer())
        .get('/api/v1/config/branding')
        .set('Host', host);
      const rootBranding = await request(app.getHttpServer())
        .get('/api/v1/config/branding')
        .set('Host', TEST_TENANT_DOMAIN);

      expect(demoBranding.body.isDemo).toBe(true);
      expect(demoBranding.body.demoExpiresAt).toBeTruthy();
      expect(rootBranding.body.isDemo).toBe(false);
      expect(rootBranding.body.demoExpiresAt).toBeNull();
    });
  });

  describe('deleting a demo early', () => {
    /**
     * The operator's gate is relaxed for demos only (v2-14). The danger of that
     * branch is not that it is wrong for demos -- it is that it might leak past
     * them -- so the test that matters most is the one below it.
     */
    it('lets a system admin delete a demo without suspending or retyping', async () => {
      await askForDemo('visitor@example.test');
      await confirm(await tokenFor('visitor@example.test'));
      const demo = await unscoped('finding the demo', () =>
        prisma.tenants.findFirstOrThrow({ where: { isDemo: true } }),
      );
      expect(demo.status).toBe('active');

      await app.get(TenantsAdminService).remove(demo.id, {} as never, 1);

      expect(
        await unscoped('confirming it went', () =>
          prisma.tenants.findUnique({ where: { id: demo.id } }),
        ),
      ).toBeNull();
    });

    // The leak check. A real community keeps every gate.
    it('still makes a real community suspend first and retype its domain', async () => {
      const real = await unscoped('seeding an ordinary community', () =>
        prisma.tenants.create({ data: { slug: 'real', domain: 'real-community.test' } }),
      );
      const admin = app.get(TenantsAdminService);

      await expect(admin.remove(real.id, {} as never, 1)).rejects.toThrow(/Suspend this community/);

      await unscoped('suspending it', () =>
        prisma.tenants.update({ where: { id: real.id }, data: { status: 'suspended' } }),
      );
      await expect(admin.remove(real.id, {} as never, 1)).rejects.toThrow(/Type real-community/);

      // And with the domain, it goes.
      await admin.remove(real.id, { confirmDomain: 'real-community.test' } as never, 1);
      expect(
        await unscoped('confirming', () => prisma.tenants.findUnique({ where: { id: real.id } })),
      ).toBeNull();
    });

    it("lets a demo's own admin delete it, and frees the slot", async () => {
      await askForDemo('owner@example.test');
      await confirm(await tokenFor('owner@example.test'));
      const demo = await unscoped('finding the demo', () =>
        prisma.tenants.findFirstOrThrow({ where: { isDemo: true } }),
      );

      await demoService.deleteOwnDemo(demo.id);

      const [gone, requests] = await unscoped('checking', async () =>
        await Promise.all([
          prisma.tenants.findUnique({ where: { id: demo.id } }),
          prisma.demo_requests.count(),
        ]),
      );
      expect(gone).toBeNull();
      // The request row carries their address and IP and goes with the demo,
      // which is also what frees their per-IP slot.
      expect(requests).toBe(0);
    });

    // The guard that matters: every demo visitor is an admin of something, so
    // without this an admin of a real community could delete it in one call.
    it('refuses to delete a community that is not a demo', async () => {
      await expect(demoService.deleteOwnDemo(TEST_TENANT_ID)).rejects.toThrow(/only a demo/i);
      expect(
        await unscoped('root survives', () =>
          prisma.tenants.findUnique({ where: { id: TEST_TENANT_ID } }),
        ),
      ).not.toBeNull();
    });
  });

  describe('the database refuses a demo root tenant', () => {
    // The application never tries this, which is exactly why the constraint is
    // worth having: the consequence of some future path getting it wrong is the
    // deployment's own community being deleted on a timer.
    it('rejects flagging the root tenant as a demo', async () => {
      await expect(
        prisma.tenants.update({ where: { id: TEST_TENANT_ID }, data: { isDemo: true } }),
      ).rejects.toThrow();
    });

    it('rejects creating a tenant that is both root and demo', async () => {
      await expect(
        prisma.tenants.create({
          data: { slug: 'both', domain: 'both.test', isRoot: true, isDemo: true },
        }),
      ).rejects.toThrow();
    });
  });
});
