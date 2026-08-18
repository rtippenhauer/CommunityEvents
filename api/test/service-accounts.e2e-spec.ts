import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { UserRole, UserStatus } from '../src/database/enums';
import { createTestApp, resetThrottler, truncateAllTables } from './utils/test-app';
import { loginAs, seedCity, seedServiceAccount, seedUser } from './utils/seed';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';

/**
 * The two protections a service account carries (see service-account.util.ts):
 * it cannot be removed, and it is not shown as a member.
 *
 * Every case keys on `is_service_account`, never on the role or the automation
 * email -- which is the point of the column. Several of these specifically seed
 * a service account holding some *other* role to prove the protection does not
 * quietly depend on it being `automation`.
 */
describe('Service accounts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let cityId: number;
  let adminCookie: string;
  let sysAdminCookie: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // automation-login carries a tight per-route @Throttle and this spec hits it
    // several times per test; without a reset the later cases 429 on limits that
    // have nothing to do with what they assert.
    resetThrottler(app);
    await truncateAllTables(prisma);
    const city = await seedCity(prisma);
    cityId = city.id;
    const admin = await seedUser(prisma, cityId, {
      role: UserRole.ADMIN,
      email: 'admin@example.test',
    });
    adminCookie = await loginAs(app, admin);
    const sysAdmin = await seedUser(prisma, cityId, {
      role: UserRole.SYSTEM_ADMIN,
      email: 'root-sysadmin@example.test',
    });
    sysAdminCookie = await loginAs(app, sysAdmin);
  });

  describe('cannot be removed', () => {
    it('refuses to ban one', async () => {
      const svc = await seedServiceAccount(prisma, cityId);

      await request(server)
        .post(`/api/v1/admin/users/${svc.id}/ban`)
        .set('Cookie', adminCookie)
        .expect(403);
    });

    it('refuses to force-ban one', async () => {
      const svc = await seedServiceAccount(prisma, cityId);

      await request(server)
        .post(`/api/v1/admin/users/${svc.id}/ban/force`)
        .set('Cookie', adminCookie)
        .expect(403);
    });

    it('refuses to admin-delete one', async () => {
      const svc = await seedServiceAccount(prisma, cityId);

      await request(server)
        .delete(`/api/v1/admin/users/${svc.id}`)
        .set('Cookie', adminCookie)
        .expect(403);

      const still = await prisma.users.findUnique({ where: { id: svc.id } });
      expect(still!.status).toBe(UserStatus.ACTIVE);
    });

    // The protection must not depend on the role, because the root tenant's
    // account is deliberately flipped to other roles for testing. A service
    // account parked on `member` is still undeletable.
    it('refuses even when the account currently holds an ordinary role', async () => {
      const svc = await seedServiceAccount(prisma, cityId, {
        role: UserRole.MEMBER,
        email: 'svc-as-member@example.test',
      });

      await request(server)
        .delete(`/api/v1/admin/users/${svc.id}`)
        .set('Cookie', adminCookie)
        .expect(403);
    });

    it('refuses self-deletion', async () => {
      const svc = await seedServiceAccount(prisma, cityId, { role: UserRole.MEMBER });
      const svcCookie = await loginAs(app, svc);

      await request(server)
        .delete('/api/v1/users/me')
        .set('Cookie', svcCookie)
        .send({ confirm: 'DELETE' })
        .expect(403);
    });

    it('still allows deleting an ordinary member', async () => {
      const member = await seedUser(prisma, cityId, { email: 'ordinary@example.test' });

      await request(server)
        .delete(`/api/v1/admin/users/${member.id}`)
        .set('Cookie', adminCookie)
        .expect(204);
    });
  });

  describe('role changes', () => {
    // A community other than the root one, reached by Host header. Its service
    // account is the case the freeze below exists for, and it cannot be
    // exercised from the root host: the role route is tenant-scoped, so another
    // community's user is not found rather than refused.
    const OTHER_DOMAIN = 'other-community.test';
    const OTHER_TENANT_ID = 90210;

    const seedOtherCommunity = async (): Promise<{ svcId: number; adminCookie: string }> => {
      await prisma.tenants.create({
        data: { id: OTHER_TENANT_ID, slug: 'other', domain: OTHER_DOMAIN },
      });
      const [svc, admin] = await runUnscoped('seeding a second community', async () => [
        await prisma.users.create({
          data: {
            tenantId: OTHER_TENANT_ID,
            cityId,
            fullName: 'Claude Automation',
            email: 'automation@dinnerbears.internal',
            role: UserRole.AUTOMATION,
            status: UserStatus.ACTIVE,
            emailStatus: 'active',
            emailVerifiedAt: new Date(),
            isServiceAccount: true,
          },
        }),
        await prisma.users.create({
          data: {
            tenantId: OTHER_TENANT_ID,
            cityId,
            fullName: 'Other Admin',
            email: 'admin@other.test',
            role: UserRole.ADMIN,
            status: UserStatus.ACTIVE,
            emailStatus: 'active',
            emailVerifiedAt: new Date(),
          },
        }),
      ]);
      // loginAs issues a real session, which writes to `users` -- a scoped
      // update. Outside a request the ambient tenant is the test root, so
      // without naming this tenant the update matches no row and throws P2025.
      const cookie = await runWithTenant(OTHER_TENANT_ID, async () => await loginAs(app, admin));
      return { svcId: svc.id, adminCookie: cookie };
    };

    // The protection that used to be keyed on the role `disabled`. Service
    // accounts are created `automation` on every tenant now, so a role-based
    // test would have silently stopped protecting anything -- this keys on what
    // the account IS: a service account outside the root tenant.
    it('refuses to change a non-root service account role', async () => {
      const { svcId, adminCookie: otherAdmin } = await seedOtherCommunity();

      await request(server)
        .post(`/api/v1/admin/users/${svcId}/role`)
        .set('Host', OTHER_DOMAIN)
        .set('Cookie', otherAdmin)
        .send({ role: 'member' })
        .expect(403);
    });

    it('refuses to promote a non-root service account to admin', async () => {
      // A role change is the only way an account that cannot be deleted could be
      // turned into one that can act, so the two protections are worth exactly
      // as much as each other.
      const { svcId, adminCookie: otherAdmin } = await seedOtherCommunity();

      await request(server)
        .post(`/api/v1/admin/users/${svcId}/role`)
        .set('Host', OTHER_DOMAIN)
        .set('Cookie', otherAdmin)
        .send({ role: 'admin' })
        .expect(403);
    });

    // Rob's live-testing affordance (2026-08-16): the root tenant's service
    // account is the one account that may be given system_admin from the UI, so
    // automation can exercise the tenant registry. Expected to revert to
    // database-only before production.
    it('allows a system admin to set system_admin on the root service account', async () => {
      const svc = await seedServiceAccount(prisma, cityId);

      await request(server)
        .post(`/api/v1/admin/users/${svc.id}/role`)
        .set('Cookie', sysAdminCookie)
        .send({ role: 'system_admin' })
        .expect(200);

      const after = await prisma.users.findUnique({ where: { id: svc.id } });
      expect(after!.role).toBe(UserRole.SYSTEM_ADMIN);
    });

    // The second half of that rule, added 2026-08-17 after Rob found the option
    // offered to him as an ordinary admin. Without this, any admin of the root
    // community could mint the role that operates every community -- the exact
    // escalation the target-side check exists to prevent, reached from the
    // actor side instead.
    it('refuses an ordinary admin setting system_admin, even on the right account', async () => {
      const svc = await seedServiceAccount(prisma, cityId);

      await request(server)
        .post(`/api/v1/admin/users/${svc.id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'system_admin' })
        .expect(403);

      const after = await prisma.users.findUnique({ where: { id: svc.id } });
      expect(after!.role).toBe(UserRole.AUTOMATION);
    });

    it('refuses an ordinary admin demoting a system_admin service account', async () => {
      const svc = await seedServiceAccount(prisma, cityId, { role: UserRole.SYSTEM_ADMIN });

      await request(server)
        .post(`/api/v1/admin/users/${svc.id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'automation' })
        .expect(403);
    });

    it('allows a system admin to flip it back down again', async () => {
      const svc = await seedServiceAccount(prisma, cityId, { role: UserRole.SYSTEM_ADMIN });

      await request(server)
        .post(`/api/v1/admin/users/${svc.id}/role`)
        .set('Cookie', sysAdminCookie)
        .send({ role: 'automation' })
        .expect(200);
    });

    it('refuses to hand out system_admin to a human', async () => {
      const member = await seedUser(prisma, cityId, { email: 'climber@example.test' });

      await request(server)
        .post(`/api/v1/admin/users/${member.id}/role`)
        .set('Cookie', sysAdminCookie)
        .send({ role: 'system_admin' })
        .expect(403);
    });

    // The carve-out is only for a *service* account. A human system admin is
    // still untouchable here, which is what keeps the exception narrow.
    it('refuses to demote an existing system admin', async () => {
      const sysAdmin = await seedUser(prisma, cityId, {
        role: UserRole.SYSTEM_ADMIN,
        email: 'sysadmin@example.test',
      });

      await request(server)
        .post(`/api/v1/admin/users/${sysAdmin.id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'member' })
        .expect(403);
    });
  });

  /**
   * Automation login, which had no coverage at all before this.
   *
   * The account is deliberately flipped between roles for testing, so the check
   * behind this endpoint must key on `is_service_account` and the tenant being
   * root -- never on the role. An earlier version required role `automation`,
   * which meant flipping the account to admin (the entire point of the flip)
   * silently locked automation out.
   */
  describe('automation login', () => {
    const SECRET = 'test-automation-secret-not-for-real-use';

    it('signs in the root tenant service account', async () => {
      await seedServiceAccount(prisma, cityId);

      const res = await request(server)
        .post('/api/v1/auth/automation-login')
        .send({ secret: SECRET })
        .expect(200);

      expect(res.body.accessToken).toBeTruthy();
    });

    it.each([UserRole.ADMIN, UserRole.SYSTEM_ADMIN, UserRole.MEMBER])(
      'still signs in while flipped to %s',
      async (role) => {
        await seedServiceAccount(prisma, cityId, { role });

        await request(server)
          .post('/api/v1/auth/automation-login')
          .send({ secret: SECRET })
          .expect(200);
      },
    );

    it('rejects a wrong secret', async () => {
      await seedServiceAccount(prisma, cityId);

      await request(server)
        .post('/api/v1/auth/automation-login')
        .send({ secret: 'not-the-secret-at-all-padding-padding' })
        .expect(401);
    });

    // Not a service account, however it is named or roled.
    it('rejects an ordinary account holding the automation role', async () => {
      await seedUser(prisma, cityId, {
        role: UserRole.AUTOMATION,
        email: 'pretender@example.test',
      });

      await request(server)
        .post('/api/v1/auth/automation-login')
        .send({ secret: SECRET })
        .expect(401);
    });
  });

  describe('not shown as members', () => {
    it('is absent from the member directory', async () => {
      const svc = await seedServiceAccount(prisma, cityId);
      const member = await seedUser(prisma, cityId, { email: 'visible@example.test' });

      const res = await request(server)
        .get('/api/v1/users/members')
        .set('Cookie', adminCookie)
        .expect(200);

      const ids = res.body.map((m: { id: number }) => m.id);
      expect(ids).toContain(member.id);
      expect(ids).not.toContain(svc.id);
    });

    it('is absent from the directory even holding an ordinary role', async () => {
      const svc = await seedServiceAccount(prisma, cityId, {
        role: UserRole.MEMBER,
        email: 'svc-member@example.test',
      });

      const res = await request(server)
        .get('/api/v1/users/members')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.map((m: { id: number }) => m.id)).not.toContain(svc.id);
    });

    it('is absent from the leaderboard, as admins are', async () => {
      await prisma.app_config.create({
        data: { configKey: 'feature_leaderboard', configValue: 'true' },
      });

      const svc = await seedServiceAccount(prisma, cityId, {
        role: UserRole.MEMBER,
        email: 'svc-points@example.test',
      });
      const member = await seedUser(prisma, cityId, { email: 'boarded@example.test' });
      const memberCookie = await loginAs(app, member);

      const res = await request(server)
        .get('/api/v1/leaderboard')
        .set('Cookie', memberCookie)
        .expect(200);

      const ids = res.body.map((r: { userId: number }) => r.userId);
      expect(ids).toContain(member.id);
      expect(ids).not.toContain(svc.id);
    });
  });

  /**
   * The scheduled sweeps were the one actor that could remove a protected
   * account: every interactive path (ban, force-ban, admin delete, self-delete)
   * already refuses admins and service accounts, but `inactivityCheck`
   * soft-deletes anything idle past 120 days and hard-deletes it 30 days later
   * with no confirmation and nobody watching.
   *
   * The realistic loss is an admin, not a service account -- someone who runs a
   * quiet community by email for four months and never signs in.
   */
  describe('automated deletion', () => {
    const longAgo = new Date(Date.now() - 200 * 86400000);

    async function runInactivitySweep(): Promise<void> {
      const { EmailDispatcherService } = await import(
        '../src/modules/email/email-dispatcher.service'
      );
      await app.get(EmailDispatcherService).inactivityCheck();
    }

    it('sweeps a long-idle ordinary member', async () => {
      const member = await seedUser(prisma, cityId, {
        email: 'idle@example.test',
        lastLoginAt: longAgo,
      });

      await runInactivitySweep();

      const after = await prisma.users.findUnique({ where: { id: member.id } });
      expect(after!.status).toBe(UserStatus.DELETED);
    });

    it.each([
      ['a service account', () => seedServiceAccount(prisma, cityId, { lastLoginAt: longAgo })],
      [
        'a tenant admin',
        () =>
          seedUser(prisma, cityId, {
            role: UserRole.ADMIN,
            email: 'idle-admin@example.test',
            lastLoginAt: longAgo,
          }),
      ],
      [
        'a system admin',
        () =>
          seedUser(prisma, cityId, {
            role: UserRole.SYSTEM_ADMIN,
            email: 'idle-sysadmin@example.test',
            lastLoginAt: longAgo,
          }),
      ],
    ])('never soft-deletes %s, however idle', async (_label, seed) => {
      const protectedUser = await seed();

      await runInactivitySweep();

      const after = await prisma.users.findUnique({ where: { id: protectedUser.id } });
      expect(after!.status).toBe(UserStatus.ACTIVE);
      expect(after!.deletedAt).toBeNull();
    });

    // Belt and braces at the far end: even a protected account that somehow
    // reached status DELETED (hand-edited row, a future path that forgets) is
    // not purged, because the purge is irreversible.
    it.each([
      ['a tenant admin', UserRole.ADMIN],
      ['a system admin', UserRole.SYSTEM_ADMIN],
    ])('never hard-deletes %s already marked deleted', async (_label, role) => {
      const marked = await seedUser(prisma, cityId, {
        role,
        email: `marked-${role}@example.test`,
        status: UserStatus.DELETED,
        deletedAt: longAgo,
        hardDeleteAt: longAgo,
      });

      const { HardDeleteTask } = await import('../src/modules/tasks/hard-delete.task');
      await app.get(HardDeleteTask).runHardDelete();

      const after = await prisma.users.findUnique({ where: { id: marked.id } });
      expect(after).not.toBeNull();
      expect(after!.fullName).not.toBe('Deleted Member');
    });
  });
});
