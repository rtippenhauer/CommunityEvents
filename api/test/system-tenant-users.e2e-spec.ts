import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { UserRole, UserStatus } from '../src/database/enums';
import { createTestApp, resetThrottler, truncateAllTables } from './utils/test-app';
import { loginAs, seedCity, seedUser } from './utils/seed';
import { TEST_TENANT_ID } from './setup-env';
import { runWithTenant } from '../src/common/tenant/tenant-store';

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

/**
 * Managing one community's people from the root tenant.
 *
 * The gap this closes: a system admin creates a community but holds no account
 * in it, and that community's own admin screens live on its host behind a
 * session for it. Before this, an admin who left or forgot their password made
 * the community permanently unreachable, with suspend-or-delete the only
 * remaining lever.
 */
describe('System tenant user management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let systemAdminCookie: string;
  let adminCookie: string;
  let tenantId: number;

  // This suite exercises the whole people surface, including the read-only
  // service-account row -- and a community other than the root one only gets a
  // service account on a stage deployment (see tenantGetsServiceAccount). The
  // flag is read at call time, so setting it here is enough.
  const originalIsStage = process.env.IS_STAGE;

  beforeAll(async () => {
    process.env.IS_STAGE = 'true';
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    if (originalIsStage === undefined) delete process.env.IS_STAGE;
    else process.env.IS_STAGE = originalIsStage;
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    // These suites make many writes per test -- creating a community is
    // several requests -- and would otherwise trip the global rate limit.
    resetThrottler(app);
    const city = await seedCity(prisma);

    const systemAdmin = await seedUser(prisma, city.id, {
      role: UserRole.SYSTEM_ADMIN,
      email: 'sysadmin@example.test',
    });
    const admin = await seedUser(prisma, city.id, {
      role: UserRole.ADMIN,
      email: 'admin@example.test',
    });
    systemAdminCookie = await loginAs(app, systemAdmin);
    adminCookie = await loginAs(app, admin);

    const created = await request(server)
      .post('/api/v1/system/tenants')
      .set('Cookie', systemAdminCookie)
      .send({
        domain: 'dayton.example.test',
        adminName: 'Dana Operator',
        adminEmail: 'dana@dayton.test',
        adminPassword: 'P@ssw0rd-Test!',
      })
      .expect(201);
    tenantId = created.body.id as number;
  });

  const usersUrl = (): string => `/api/v1/system/tenants/${tenantId}/users`;

  describe('access', () => {
    it('refuses an ordinary tenant admin', async () => {
      await request(server).get(usersUrl()).set('Cookie', adminCookie).expect(403);
    });

    it('refuses an unauthenticated request', async () => {
      await request(server).get(usersUrl()).expect(401);
    });
  });

  describe('GET', () => {
    it('lists that community members, including its service account', async () => {
      const res = await request(server)
        .get(usersUrl())
        .set('Cookie', systemAdminCookie)
        .expect(200);

      const emails = res.body.map((u: { email: string }) => u.email);
      expect(emails).toContain('dana@dayton.test');
      expect(res.body.find((u: { email: string }) => u.email === 'dana@dayton.test').role).toBe(
        UserRole.ADMIN,
      );
      expect(res.body.some((u: { isServiceAccount: boolean }) => u.isServiceAccount)).toBe(true);
    });

    // The property the whole module depends on: the tenant id in the route is
    // the only thing selecting rows, and the extension applies it.
    it('does not leak the root community accounts', async () => {
      const res = await request(server)
        .get(usersUrl())
        .set('Cookie', systemAdminCookie)
        .expect(200);

      const emails = res.body.map((u: { email: string }) => u.email);
      expect(emails).not.toContain('sysadmin@example.test');
      expect(emails).not.toContain('admin@example.test');
    });

    it('404s for a community that does not exist', async () => {
      await request(server)
        .get('/api/v1/system/tenants/99999/users')
        .set('Cookie', systemAdminCookie)
        .expect(404);
    });
  });

  describe('POST', () => {
    it('creates a member inside that community', async () => {
      const res = await request(server)
        .post(usersUrl())
        .set('Cookie', systemAdminCookie)
        .send({
          fullName: 'Sam Member',
          email: 'sam@dayton.test',
          password: 'P@ssw0rd-Test!',
          role: UserRole.MODERATOR,
        })
        .expect(201);

      expect(res.body.role).toBe(UserRole.MODERATOR);

      const row = await inTenant(tenantId, () =>
        prisma.users.findFirst({ where: { email: 'sam@dayton.test' } }),
      );
      expect(row).not.toBeNull();
      expect(row!.tenantId).toBe(tenantId);
      // Verified on creation, like the first admin: an unverified account on a
      // community with no reachable admin has nobody to ask.
      expect(row!.emailVerifiedAt).not.toBeNull();
    });

    it('refuses an address already used in that community', async () => {
      await request(server)
        .post(usersUrl())
        .set('Cookie', systemAdminCookie)
        .send({ fullName: 'Dup', email: 'dana@dayton.test', password: 'P@ssw0rd-Test!' })
        .expect(400);
    });

    // Email uniqueness is per-tenant (REQ-TENANT-01.5), so the same address
    // holding an account elsewhere is not a clash.
    it('allows an address that exists in another community', async () => {
      await request(server)
        .post(usersUrl())
        .set('Cookie', systemAdminCookie)
        .send({ fullName: 'Same Person', email: 'admin@example.test', password: 'P@ssw0rd-Test!' })
        .expect(201);

      const rootCount = await inTenant(TEST_TENANT_ID, () =>
        prisma.users.count({ where: { email: 'admin@example.test' } }),
      );
      expect(rootCount).toBe(1);
    });

    it('refuses the reserved service-account address', async () => {
      await request(server)
        .post(usersUrl())
        .set('Cookie', systemAdminCookie)
        .send({
          fullName: 'Impostor',
          email: 'automation@communityevents.internal',
          password: 'P@ssw0rd-Test!',
        })
        .expect(400);
    });

    // system_admin operates the whole deployment. A per-community screen must
    // not be one dropdown away from granting it -- same rule setRole enforces.
    it('refuses to create a system admin', async () => {
      await request(server)
        .post(usersUrl())
        .set('Cookie', systemAdminCookie)
        .send({
          fullName: 'Escalation',
          email: 'boss@dayton.test',
          password: 'P@ssw0rd-Test!',
          role: UserRole.SYSTEM_ADMIN,
        })
        .expect(400);
    });

    it('refuses a password below the registration floor', async () => {
      await request(server)
        .post(usersUrl())
        .set('Cookie', systemAdminCookie)
        .send({ fullName: 'Weak', email: 'weak@dayton.test', password: 'short' })
        .expect(400);
    });
  });

  describe('PATCH', () => {
    let danaId: number;

    beforeEach(async () => {
      const row = await inTenant(tenantId, () =>
        prisma.users.findFirst({ where: { email: 'dana@dayton.test' } }),
      );
      danaId = row!.id;
    });

    it('changes a role', async () => {
      const res = await request(server)
        .patch(`${usersUrl()}/${danaId}`)
        .set('Cookie', systemAdminCookie)
        .send({ role: UserRole.MEMBER })
        .expect(200);

      expect(res.body.role).toBe(UserRole.MEMBER);
    });

    it('suspends and restores an account', async () => {
      await request(server)
        .patch(`${usersUrl()}/${danaId}`)
        .set('Cookie', systemAdminCookie)
        .send({ status: UserStatus.SUSPENDED })
        .expect(200);

      const suspended = await inTenant(tenantId, () =>
        prisma.users.findUnique({ where: { id: danaId } }),
      );
      expect(suspended!.status).toBe(UserStatus.SUSPENDED);

      await request(server)
        .patch(`${usersUrl()}/${danaId}`)
        .set('Cookie', systemAdminCookie)
        .send({ status: UserStatus.ACTIVE })
        .expect(200);
    });

    // `deleted` is the tombstone the account-deletion flow sets. Reaching it
    // here would look like a delete while leaving every row in place.
    it('refuses to set the deleted tombstone', async () => {
      await request(server)
        .patch(`${usersUrl()}/${danaId}`)
        .set('Cookie', systemAdminCookie)
        .send({ status: 'deleted' })
        .expect(400);
    });

    it('refuses to grant system_admin', async () => {
      await request(server)
        .patch(`${usersUrl()}/${danaId}`)
        .set('Cookie', systemAdminCookie)
        .send({ role: UserRole.SYSTEM_ADMIN })
        .expect(400);
    });

    it('refuses to touch the service account', async () => {
      const svc = await inTenant(tenantId, () =>
        prisma.users.findFirst({ where: { isServiceAccount: true } }),
      );

      await request(server)
        .patch(`${usersUrl()}/${svc!.id}`)
        .set('Cookie', systemAdminCookie)
        .send({ role: UserRole.ADMIN })
        .expect(400);
    });

    // A user id from another community must not be reachable through this
    // community route. The lookup is scoped, so it simply is not found.
    it('404s for a user belonging to a different community', async () => {
      const root = await inTenant(TEST_TENANT_ID, () =>
        prisma.users.findFirst({ where: { email: 'admin@example.test' } }),
      );

      await request(server)
        .patch(`${usersUrl()}/${root!.id}`)
        .set('Cookie', systemAdminCookie)
        .send({ role: UserRole.MEMBER })
        .expect(404);

      const unchanged = await inTenant(TEST_TENANT_ID, () =>
        prisma.users.findUnique({ where: { id: root!.id } }),
      );
      expect(unchanged!.role).toBe(UserRole.ADMIN);
    });
  });

  describe('password reset', () => {
    let danaId: number;

    beforeEach(async () => {
      const row = await inTenant(tenantId, () =>
        prisma.users.findFirst({ where: { email: 'dana@dayton.test' } }),
      );
      danaId = row!.id;
    });

    it('sets a password the owner can sign in with', async () => {
      const before = await inTenant(tenantId, () =>
        prisma.users.findUnique({ where: { id: danaId } }),
      );

      await request(server)
        .post(`${usersUrl()}/${danaId}/password`)
        .set('Cookie', systemAdminCookie)
        .send({ password: 'A-New-P@ssword!' })
        .expect(201);

      const after = await inTenant(tenantId, () =>
        prisma.users.findUnique({ where: { id: danaId } }),
      );
      expect(after!.passwordHash).not.toBe(before!.passwordHash);
    });

    it('invalidates any outstanding reset link', async () => {
      // The operator has just set a password out of band; leaving a live token
      // would let whoever holds it overwrite that immediately.
      await inTenant(tenantId, () =>
        prisma.users.update({
          where: { id: danaId },
          data: {
            passwordResetToken: 'still-live',
            passwordResetExpiresAt: new Date(Date.now() + 3_600_000),
          },
        }),
      );

      await request(server)
        .post(`${usersUrl()}/${danaId}/password`)
        .set('Cookie', systemAdminCookie)
        .send({ password: 'A-New-P@ssword!' })
        .expect(201);

      const after = await inTenant(tenantId, () =>
        prisma.users.findUnique({ where: { id: danaId } }),
      );
      expect(after!.passwordResetToken).toBeNull();
      expect(after!.passwordResetExpiresAt).toBeNull();
    });

    it('refuses for the service account', async () => {
      const svc = await inTenant(tenantId, () =>
        prisma.users.findFirst({ where: { isServiceAccount: true } }),
      );

      await request(server)
        .post(`${usersUrl()}/${svc!.id}/password`)
        .set('Cookie', systemAdminCookie)
        .send({ password: 'A-New-P@ssword!' })
        .expect(400);
    });

    it('is refused for an ordinary admin', async () => {
      await request(server)
        .post(`${usersUrl()}/${danaId}/password`)
        .set('Cookie', adminCookie)
        .send({ password: 'A-New-P@ssword!' })
        .expect(403);
    });
  });
});
