import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { UserRole, UserStatus } from '../src/database/enums';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { loginAs, seedCity, seedServiceAccount, seedUser } from './utils/seed';

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

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    const city = await seedCity(prisma);
    cityId = city.id;
    const admin = await seedUser(prisma, cityId, {
      role: UserRole.ADMIN,
      email: 'admin@example.test',
    });
    adminCookie = await loginAs(app, admin);
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
    // A role change is the only way an account that cannot be deleted could be
    // turned into one that can act, so the two protections are worth exactly as
    // much as each other.
    it('refuses to change the role of a disabled service account', async () => {
      const svc = await seedServiceAccount(prisma, cityId, { role: UserRole.DISABLED });

      await request(server)
        .post(`/api/v1/admin/users/${svc.id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'member' })
        .expect(403);
    });

    it('refuses to promote a disabled service account to admin', async () => {
      const svc = await seedServiceAccount(prisma, cityId, { role: UserRole.DISABLED });

      await request(server)
        .post(`/api/v1/admin/users/${svc.id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'admin' })
        .expect(403);
    });

    it('refuses to hand out system_admin', async () => {
      const member = await seedUser(prisma, cityId, { email: 'climber@example.test' });

      await request(server)
        .post(`/api/v1/admin/users/${member.id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'system_admin' })
        .expect(403);
    });

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

  describe('inactivity sweep', () => {
    // The sweep that would actually have deleted one. A service account either
    // never logs in or logs in rarely, so it drifts past the 120-day threshold
    // on its own; losing the row orphans every audit and release-notes FK
    // pointing at it.
    it('leaves a long-idle service account alone but sweeps an idle member', async () => {
      const longAgo = new Date(Date.now() - 200 * 86400000);

      const svc = await seedServiceAccount(prisma, cityId, { lastLoginAt: longAgo });
      const member = await seedUser(prisma, cityId, {
        email: 'idle@example.test',
        lastLoginAt: longAgo,
      });

      const { EmailDispatcherService } = await import(
        '../src/modules/email/email-dispatcher.service'
      );
      await app.get(EmailDispatcherService).inactivityCheck();

      const svcAfter = await prisma.users.findUnique({ where: { id: svc.id } });
      const memberAfter = await prisma.users.findUnique({ where: { id: member.id } });

      expect(svcAfter!.status).toBe(UserStatus.ACTIVE);
      expect(memberAfter!.status).toBe(UserStatus.DELETED);
    });
  });
});
