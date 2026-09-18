import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { runUnscoped } from '../src/common/tenant/tenant-store';
import { DemoResetTask } from '../src/modules/tasks/demo-reset.task';
import { UserRole } from '../src/database/enums';
import { createTestApp, truncateAllTables, resetThrottler, TEST_TENANT_DOMAIN } from './utils/test-app';
import { seedCity } from './utils/seed';
import { TEST_TENANT_ID } from './setup-env';

const unscoped = <T>(reason: string, fn: () => Promise<T>): Promise<T> =>
  runUnscoped(reason, async () => await fn());

/**
 * The Definition of Done for v2-14, asserted end to end.
 *
 * The demo is the one place in the system where a stranger becomes an admin, so
 * the assertions that matter most are the negative ones: the same registration
 * on any other community is refused, and the admin role a demo signup grants
 * does not reach past that community. Both are checked against a *real second
 * tenant* in the same database rather than against the absence of one — a
 * missing tenant would make every negative case pass vacuously.
 */
describe('Demo tenant (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: TenantResolutionService;

  const DEMO_TENANT_ID = 2;
  const DEMO_DOMAIN = 'demo.test-root.test';
  const ORDINARY_TENANT_ID = 3;
  const ORDINARY_DOMAIN = 'ordinary-community.test';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenants = app.get(TenantResolutionService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma); // re-seeds the root tenant at TEST_TENANT_ID
    tenants.clearCache();
    resetThrottler(app);

    await prisma.tenants.create({
      data: { id: DEMO_TENANT_ID, slug: 'demo', domain: DEMO_DOMAIN, isDemo: true },
    });
    await prisma.tenants.create({
      data: { id: ORDINARY_TENANT_ID, slug: 'ordinary', domain: ORDINARY_DOMAIN },
    });

    // `users.city_id` is NOT NULL and `cities` is global, so one city serves
    // every tenant here.
    await unscoped('seeding the shared city fixture', () => seedCity(prisma));
  });

  const register = (host: string, email: string) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Host', host)
      .send({ fullName: 'Casual Visitor', email, password: 'V1sitorPassw0rd!' });

  describe('self-registration', () => {
    it('grants admin of the demo community, signed in, with no invite', async () => {
      const res = await register(DEMO_DOMAIN, 'visitor@example.test');

      expect(res.status).toBe(201);
      expect(res.body.signedIn).toBe(true);
      // Signed in means a cookie was actually set -- the DoD is "lands as an
      // admin", not "an admin row exists somewhere".
      expect(String(res.headers['set-cookie'])).toContain('access_token=');

      const created = await unscoped('checking which tenant the new admin belongs to', () =>
        prisma.users.findFirst({ where: { email: 'visitor@example.test' } }),
      );
      expect(created?.role).toBe(UserRole.ADMIN);
      expect(created?.tenantId).toBe(DEMO_TENANT_ID);
      // Created verified, deliberately: there is no mail to wait for, and login
      // refuses anything still pending.
      expect(created?.emailStatus).toBe('active');
      expect(created?.emailVerifiedAt).not.toBeNull();
    });

    // The escalation this item exists to avoid. An ordinary community is
    // invite-gated exactly as before.
    it('is refused on an ordinary community', async () => {
      const res = await register(ORDINARY_DOMAIN, 'visitor@example.test');

      expect(res.status).toBe(401);
      expect(res.body.reason).toBe('no_invite');

      const created = await unscoped('confirming nothing was created', () =>
        prisma.users.findFirst({ where: { email: 'visitor@example.test' } }),
      );
      expect(created).toBeNull();
    });

    // The root tenant is the deployment's own community and holds the system
    // admin, so this is the worst case of the same bug.
    it('is refused on the root community', async () => {
      const res = await register(TEST_TENANT_DOMAIN, 'visitor@example.test');

      expect(res.status).toBe(401);
      expect(res.body.reason).toBe('no_invite');
    });

    // "Admin *of that tenant only*". The role is per-user and users are
    // tenant-scoped, so a demo admin is not a member of anywhere else at all --
    // asserted rather than assumed, because it is the property the carve-out
    // rests on.
    it('does not make the visitor an admin anywhere else', async () => {
      await register(DEMO_DOMAIN, 'visitor@example.test');

      const elsewhere = await unscoped('looking for the demo admin in other tenants', () =>
        prisma.users.findMany({
          where: { email: 'visitor@example.test', tenantId: { not: DEMO_TENANT_ID } },
        }),
      );
      expect(elsewhere).toEqual([]);
    });

    // One address can hold a separate account per community (v2-6), so the same
    // person registering on the demo and being invited elsewhere is ordinary --
    // and the demo's grant must not follow them.
    it('leaves an account with the same address in another community untouched', async () => {
      await register(DEMO_DOMAIN, 'visitor@example.test');
      const member = await unscoped('seeding the same address in an ordinary community', () =>
        prisma.users.create({
          data: {
            tenantId: ORDINARY_TENANT_ID,
            cityId: 1,
            fullName: 'Casual Visitor',
            email: 'visitor@example.test',
            role: UserRole.MEMBER,
            status: 'active',
            emailStatus: 'active',
          },
        }),
      );

      expect(member.role).toBe(UserRole.MEMBER);
    });
  });

  describe('the standing notice', () => {
    it('is announced in the branding payload for the demo and nowhere else', async () => {
      const demo = await request(app.getHttpServer())
        .get('/api/v1/config/branding')
        .set('Host', DEMO_DOMAIN);
      const ordinary = await request(app.getHttpServer())
        .get('/api/v1/config/branding')
        .set('Host', ORDINARY_DOMAIN);

      expect(demo.body.isDemo).toBe(true);
      expect(ordinary.body.isDemo).toBe(false);
    });
  });

  describe('the scheduled reset', () => {
    it('erases what visitors did and puts the seeded community back', async () => {
      // A visitor signs up, becomes an admin, and does what a demo admin can do.
      await register(DEMO_DOMAIN, 'visitor@example.test');
      const junk = await unscoped('a demo admin adding their own content', async () => {
        const visitor = await prisma.users.findFirstOrThrow({
          where: { email: 'visitor@example.test' },
        });
        return await prisma.locations.create({
          data: {
            tenantId: DEMO_TENANT_ID,
            cityId: 1,
            name: 'Somewhere a visitor added',
            address: '1 Nowhere',
            createdById: visitor.id,
          },
        });
      });

      await app.get(DemoResetTask).runDemoReset();

      const [survivingJunk, visitor, seededMembers, upcoming] = await unscoped(
        'inspecting the demo after its reset',
        async () =>
          await Promise.all([
            prisma.locations.findFirst({ where: { id: junk.id } }),
            prisma.users.findFirst({ where: { email: 'visitor@example.test' } }),
            prisma.users.count({
              where: { tenantId: DEMO_TENANT_ID, isServiceAccount: false },
            }),
            prisma.events.count({ where: { tenantId: DEMO_TENANT_ID } }),
          ]),
      );

      expect(survivingJunk).toBeNull();
      // The visitor's admin account goes with it. That is the point: the grant
      // is disposable because what it grants admin over is.
      expect(visitor).toBeNull();
      expect(seededMembers).toBeGreaterThan(0);
      expect(upcoming).toBeGreaterThan(0);
    });

    // Everything a community needs in order to function is a scoped row too, so
    // the wipe takes it. A reset that forgot to put these back would leave a
    // demo with blank Terms and no achievement catalogue -- which looks fine
    // until somebody opens /terms.
    it('restores the rows a community cannot work without', async () => {
      await app.get(DemoResetTask).runDemoReset();

      const [legal, achievements, emailConfig] = await unscoped(
        'checking the demo was rebuilt whole',
        async () =>
          await Promise.all([
            prisma.app_config.findFirst({
              where: { tenantId: DEMO_TENANT_ID, configKey: 'legal_terms_html' },
            }),
            prisma.achievements.count({ where: { tenantId: DEMO_TENANT_ID } }),
            prisma.email_provider_config.findFirst({ where: { tenantId: DEMO_TENANT_ID } }),
          ]),
      );

      expect(legal?.configValue).toBeTruthy();
      expect(achievements).toBeGreaterThan(0);
      expect(emailConfig).not.toBeNull();
    });

    it('leaves every other community alone', async () => {
      const untouched = await unscoped('seeding a real community beside the demo', async () => {
        const member = await prisma.users.create({
          data: {
            tenantId: ORDINARY_TENANT_ID,
            cityId: 1,
            fullName: 'Real Member',
            email: 'real@example.test',
            role: UserRole.ADMIN,
            status: 'active',
            emailStatus: 'active',
          },
        });
        return await prisma.locations.create({
          data: {
            tenantId: ORDINARY_TENANT_ID,
            cityId: 1,
            name: 'A real venue in a real community',
            address: '2 Somewhere',
            createdById: member.id,
          },
        });
      });

      await app.get(DemoResetTask).runDemoReset();

      const survivor = await unscoped('confirming the neighbour survived', () =>
        prisma.locations.findFirst({ where: { id: untouched.id } }),
      );
      expect(survivor).not.toBeNull();
    });

    // A demo whose invites had been used would otherwise trip
    // `users.invite_id -> invites`, which MySQL checks immediately. The same
    // foreign key would have broken deleting any populated community; see
    // tenant-purge.ts.
    it('resets a demo whose invites have been redeemed', async () => {
      await unscoped('a demo admin inviting somebody, who joins', async () => {
        const inviter = await prisma.users.create({
          data: {
            tenantId: DEMO_TENANT_ID,
            cityId: 1,
            fullName: 'Demo Admin',
            email: 'demo-admin@example.test',
            role: UserRole.ADMIN,
            status: 'active',
            emailStatus: 'active',
          },
        });
        const invite = await prisma.invites.create({
          data: {
            tenantId: DEMO_TENANT_ID,
            token: 'demo-invite-token',
            type: 'member',
            createdBy: inviter.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        await prisma.users.create({
          data: {
            tenantId: DEMO_TENANT_ID,
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
      });

      await expect(app.get(DemoResetTask).runDemoReset()).resolves.not.toThrow();

      const leftovers = await unscoped('confirming the invite chain went too', () =>
        prisma.invites.count({ where: { tenantId: DEMO_TENANT_ID } }),
      );
      expect(leftovers).toBe(0);
    });
  });

  describe('the database refuses a demo root tenant', () => {
    // `chk_tenant_demo_not_root`. The application checks this too, but the
    // consequence of being wrong is self-registration granting admin over the
    // deployment's own community, which is the kind of invariant that belongs
    // below the application -- the same argument `root_marker` makes.
    it('rejects flagging the root tenant as the demo', async () => {
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
