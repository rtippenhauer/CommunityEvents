import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables, resetThrottler, TEST_TENANT_DOMAIN } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import { UserRole } from '../src/database/enums';
import { TEST_TENANT_ID } from './setup-env';
import type { cities as City } from '@prisma/client';

const unscoped = <T>(reason: string, fn: () => Promise<T>): Promise<T> =>
  runUnscoped(reason, async () => await fn());

/**
 * Issuing a session writes a scoped `login_sessions` row, so it has to happen
 * inside the owning tenant's context. Awaited inside the callback, never
 * returned from it -- Prisma promises are lazy, so returning one builds the
 * query in the context and runs it outside.
 */
const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

/**
 * Releases are deployment-wide; the feedback behind them is not (v2-review
 * 2026-10-02).
 *
 * Two defects, both found by static review and neither reachable by the suite as
 * it stood, because every release test ran on one tenant with one admin.
 *
 * 1. `releases` and `release_feedback` are global, but `ReleasesAdminController`
 *    was `@Roles(ADMIN)` with no root-tenant requirement — so any community's
 *    admin could edit and publish the notes the whole deployment reads.
 * 2. `RELEASE_INCLUDE` traversed `releases -> release_feedback -> feedback`,
 *    which is the one global-parent-to-scoped-model hop the Prisma extension
 *    documents that it cannot filter. Every signed-in member therefore received
 *    other communities' feedback in full, private tickets included.
 */
describe('Release isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let city: City;

  let rootAdminCookie: string;
  let rootMemberCookie: string;
  let otherAdminCookie: string;
  let otherTenantId: number;
  let rootAdminId: number;
  let otherDomain: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    resetThrottler(app);
    city = await seedCity(prisma);

    const rootAdmin = await seedUser(prisma, city.id, {
      role: UserRole.ADMIN,
      email: 'rootadmin@example.test',
    });
    const rootMember = await seedUser(prisma, city.id, {
      role: UserRole.MEMBER,
      email: 'rootmember@example.test',
    });
    rootAdminId = rootAdmin.id;
    rootAdminCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, rootAdmin));
    rootMemberCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, rootMember));

    // A second community, with its own admin. This is the fixture the old tests
    // never had, and the only one that can see either defect.
    otherDomain = 'other-release.example.test';
    const other = await unscoped('creating a second community', async () => {
      const tenant = await prisma.tenants.create({
        data: { slug: 'other-release', domain: otherDomain, status: 'active' },
      });
      await prisma.users.create({
        data: {
          tenantId: tenant.id,
          cityId: city.id,
          fullName: 'Other Admin',
          email: 'otheradmin@example.test',
          role: UserRole.ADMIN,
          status: 'active',
          emailStatus: 'active',
          emailVerifiedAt: new Date(),
        },
      });
      return tenant.id;
    });
    otherTenantId = other;

    const otherAdmin = await unscoped('finding the other admin', async () =>
      await prisma.users.findFirst({ where: { email: 'otheradmin@example.test' } }),
    );
    otherAdminCookie = await inTenant(otherTenantId, () => loginAs(app, otherAdmin!));
  });

  describe('administering the deployment-wide release notes', () => {
    it('lets the root tenant admin in', async () => {
      await request(server)
        .get('/api/v1/admin/releases')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(200);
    });

    /**
     * The defect. `releases` is global, so this admin was not administering
     * their own community — they were operating the release-note system every
     * community reads. Same shape as `/admin/email` before v2-9.
     */
    it('refuses another community\'s admin on their own host', async () => {
      await request(server)
        .get('/api/v1/admin/releases')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(403);
    });

    it('refuses publishing from another community', async () => {
      const release = await unscoped('seeding a draft', async () =>
        await prisma.releases.create({
          data: { version: '9.9.9', title: 'Draft', body: 'x', createdBy: rootAdminId },
        }),
      );

      await request(server)
        .post(`/api/v1/admin/releases/${release.id}/publish`)
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(403);

      const after = await unscoped('checking it is still a draft', async () =>
        await prisma.releases.findUnique({ where: { id: release.id } }),
      );
      expect(after!.publishedAt).toBeNull();
    });

    // A member of the root tenant is still not an operator.
    it('refuses an ordinary root-tenant member', async () => {
      await request(server)
        .get('/api/v1/admin/releases')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootMemberCookie)
        .expect(403);
    });
  });

  describe('feedback credited on a published release', () => {
    /**
     * Builds one published release linked to feedback from BOTH communities,
     * one of which is private. This is the shape that leaked.
     */
    const seedCrossTenantRelease = async (): Promise<{ ourFeedbackId: number }> =>
      await unscoped('seeding a release linked across two communities', async () => {
        const release = await prisma.releases.create({
          data: {
            version: '2.0.0',
            title: 'Shipped',
            body: 'notes',
            publishedAt: new Date(),
            createdBy: rootAdminId,
          },
        });

        const ours = await prisma.feedback.create({
          data: {
            tenantId: TEST_TENANT_ID,
            userId: (await prisma.users.findFirst({ where: { email: 'rootmember@example.test' } }))!.id,
            category: 'feature_request',
            body: 'ours — public',
            isPrivate: false,
          },
        });
        const theirs = await prisma.feedback.create({
          data: {
            tenantId: otherTenantId,
            userId: (await prisma.users.findFirst({ where: { email: 'otheradmin@example.test' } }))!.id,
            category: 'feature_request',
            title: 'Their private title',
            body: 'THEIR SECRET BODY',
            adminNote: 'THEIR ADMIN NOTE',
            isPrivate: true,
          },
        });

        await prisma.release_feedback.createMany({
          data: [
            { releaseId: release.id, feedbackId: ours.id },
            { releaseId: release.id, feedbackId: theirs.id },
          ],
        });
        return { ourFeedbackId: ours.id };
      });

    /**
     * The load-bearing assertion. Before the fix this response carried the other
     * community's private feedback body and admin note to any signed-in member.
     */
    it('never carries another community\'s feedback', async () => {
      const { ourFeedbackId } = await seedCrossTenantRelease();

      const res = await request(server)
        .get('/api/v1/releases')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootMemberCookie)
        .expect(200);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('THEIR SECRET BODY');
      expect(body).not.toContain('THEIR ADMIN NOTE');
      expect(body).not.toContain('Their private title');

      // Our own community's link survives, so the credit line still works.
      const linked = res.body[0].linkedFeedback as { id: number }[];
      expect(linked.map((fb) => fb.id)).toEqual([ourFeedbackId]);
    });

    /**
     * And the shape is narrowed as well as filtered. Nothing in the app renders
     * a feedback body from a release, so serving one was pure exposure even
     * within a single community.
     */
    it('carries only what the credit line needs', async () => {
      await seedCrossTenantRelease();

      const res = await request(server)
        .get('/api/v1/releases')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootMemberCookie)
        .expect(200);

      const [fb] = res.body[0].linkedFeedback as Record<string, unknown>[];
      expect(Object.keys(fb).sort()).toEqual(['id', 'isPrivate', 'user']);
      expect(fb.body).toBeUndefined();
      expect(fb.adminNote).toBeUndefined();
      expect(fb.status).toBeUndefined();
    });

    // Seen from the other community, the symmetric property: they get their own
    // credit and not ours.
    it('credits each community only its own contributors', async () => {
      await seedCrossTenantRelease();

      const res = await request(server)
        .get('/api/v1/releases')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      const linked = res.body[0].linkedFeedback as { isPrivate: boolean }[];
      expect(linked).toHaveLength(1);
      expect(linked[0].isPrivate).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('ours — public');
    });

    /**
     * Counted, not discarded (Rob, 2026-10-03).
     *
     * The isolation above was correct and incomplete: a ticket from another
     * community was dropped with no trace, so a release shipped entirely on
     * somebody else's report credited nobody at all. The fix keeps the identity
     * behind the boundary and lets the *fact* of a contributor cross it.
     */
    it("counts the other community's contributors without naming them", async () => {
      await seedCrossTenantRelease();

      const res = await request(server)
        .get('/api/v1/releases')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootMemberCookie)
        .expect(200);

      expect(res.body[0].linkedFeedback).toHaveLength(1);
      expect(res.body[0].anonymousCredits).toBe(1);
    });

    // Symmetric, and the reason this is not just a nicety: each side sees one
    // named contributor and one anonymous one, so neither community is told it
    // was the only one asking.
    it('counts anonymously in both directions', async () => {
      await seedCrossTenantRelease();

      const res = await request(server)
        .get('/api/v1/releases')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      expect(res.body[0].linkedFeedback).toHaveLength(1);
      expect(res.body[0].anonymousCredits).toBe(1);
    });

    /**
     * The count is a number and nothing else. An id would say which rows exist
     * elsewhere, which is the information the tenant boundary is for.
     */
    it('sends no identifying detail with the anonymous count', async () => {
      await seedCrossTenantRelease();

      const theirFeedbackId = await unscoped('finding their ticket', async () => {
        const row = await prisma.feedback.findFirst({ where: { tenantId: otherTenantId } });
        return row!.id;
      });

      const res = await request(server)
        .get('/api/v1/releases')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootMemberCookie)
        .expect(200);

      const linked = res.body[0].linkedFeedback as { id: number }[];
      expect(linked.map((fb) => fb.id)).not.toContain(theirFeedbackId);
      expect(typeof res.body[0].anonymousCredits).toBe('number');
    });
  });
});
