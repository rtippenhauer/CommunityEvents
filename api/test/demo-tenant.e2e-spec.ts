import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import {
  DemoService,
  DEMO_IDLE_HOURS,
  MAX_LIVE_DEMOS,
  MAX_LIVE_DEMOS_PER_IP,
} from '../src/modules/demo/demo.service';
import { EmailService } from '../src/modules/email/email.service';
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

    it('clears lapsed unconfirmed requests so they stop holding slots', async () => {
      await askForDemo('abandoned@example.test');
      await unscoped('ageing the request', () =>
        prisma.demo_requests.updateMany({
          where: { createdTenantId: null },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      );

      const result = await demoService.deleteExpired();

      expect(result.requests).toBe(1);
      expect(await unscoped('counting', () => prisma.demo_requests.count())).toBe(0);
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
