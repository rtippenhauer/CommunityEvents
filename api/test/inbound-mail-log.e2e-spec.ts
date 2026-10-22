import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables, resetThrottler, TEST_TENANT_DOMAIN } from './utils/test-app';
import { seedCity, seedUser, seedServiceAccount, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import { InboundEmailOutcome, UserRole } from '../src/database/enums';
import { TEST_TENANT_ID } from './setup-env';
import type { cities as City } from '@prisma/client';

const unscoped = <T>(reason: string, fn: () => Promise<T>): Promise<T> =>
  runUnscoped(reason, async () => await fn());

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

/**
 * The inbound mail log's visibility rules (v2-34).
 *
 * `inbound_emails` is a **global** model, so the tenant-scoping extension
 * injects nothing: a read that forgets its predicate returns every community's
 * mail and does not throw. That is the one defect in this item that would be
 * invisible to a single-tenant test and serious in production, so this suite
 * runs two communities and an operator.
 *
 * The rule (Rob, 2026-10-20): **the operator sees every row, including the ones
 * belonging to no community; a community's admins see only their own.**
 */
describe('Inbound mail log (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let city: City;

  let rootAdminCookie: string;
  let operatorCookie: string;
  let otherAdminCookie: string;
  let otherTenantId: number;
  let otherDomain: string;

  const seedRow = (data: {
    tenantId: number | null;
    outcome: string;
    fromAddress?: string;
    subject?: string;
    rawBody?: string | null;
    sourceIp?: string;
  }) =>
    unscoped('seeding an inbound row', async () =>
      prisma.inbound_emails.create({
        data: {
          tenantId: data.tenantId,
          outcome: data.outcome as never,
          fromAddress: data.fromAddress ?? 'someone@example.test',
          subject: data.subject ?? 'Accepted: Dinner',
          rawBody: data.rawBody ?? 'BEGIN:VCALENDAR',
          sizeBytes: 42,
          sourceIp: data.sourceIp ?? '203.0.113.9',
        },
        select: { id: true },
      }),
    );

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
    rootAdminCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, rootAdmin));

    // The operator: the root tenant's service account, which is what
    // OperatorGuard accepts regardless of the role it is currently wearing.
    const operator = await seedServiceAccount(prisma, city.id);
    operatorCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, operator));

    otherDomain = 'other-inbound.example.test';
    otherTenantId = await unscoped('creating a second community', async () => {
      const tenant = await prisma.tenants.create({
        data: { slug: 'other-inbound', domain: otherDomain, status: 'active' },
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

    const otherAdmin = await unscoped('finding the other admin', async () =>
      prisma.users.findFirst({ where: { email: 'otheradmin@example.test' } }),
    );
    otherAdminCookie = await inTenant(otherTenantId, () => loginAs(app, otherAdmin!));
  });

  describe('a community admin sees their own rows and nothing else', () => {
    it('returns only this community\'s rows', async () => {
      await seedRow({ tenantId: TEST_TENANT_ID, outcome: InboundEmailOutcome.RECORDED, subject: 'mine' });
      await seedRow({ tenantId: otherTenantId, outcome: InboundEmailOutcome.RECORDED, subject: 'theirs' });

      const res = await request(server)
        .get('/api/v1/admin/email/inbound')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(200);

      expect(res.body.rows.map((r: { subject: string }) => r.subject)).toEqual(['mine']);
      expect(res.body.total).toBe(1);
    });

    /**
     * The row that matters most is also the one a community must not see. A
     * message that matched no community may name a *different* community's
     * address, which is the customer list v2-32 is careful never to disclose.
     */
    it('never returns a row that resolved to no community', async () => {
      await seedRow({ tenantId: null, outcome: InboundEmailOutcome.UNKNOWN_UID, subject: 'nobody' });

      const res = await request(server)
        .get('/api/v1/admin/email/inbound')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(200);

      expect(res.body.rows).toEqual([]);
    });

    /** `?tenantId=` is an operator filter; a community sending it cannot widen its own view. */
    it('ignores a tenantId filter aimed at another community', async () => {
      await seedRow({ tenantId: otherTenantId, outcome: InboundEmailOutcome.RECORDED, subject: 'theirs' });

      const res = await request(server)
        .get(`/api/v1/admin/email/inbound?tenantId=${otherTenantId}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(200);

      expect(res.body.rows).toEqual([]);
    });

    it('withholds the source IP, which is not theirs to know', async () => {
      await seedRow({ tenantId: TEST_TENANT_ID, outcome: InboundEmailOutcome.RECORDED });

      const res = await request(server)
        .get('/api/v1/admin/email/inbound')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(200);

      expect(res.body.rows[0].sourceIp).toBeNull();
    });

    /**
     * The detail view has to repeat the list's predicate. Fetching a row by id
     * is otherwise the obvious way around the isolation the list enforces --
     * and the body is the whole message, not a summary of it.
     */
    it('refuses to open another community\'s message by id', async () => {
      const theirs = await seedRow({
        tenantId: otherTenantId,
        outcome: InboundEmailOutcome.RECORDED,
        rawBody: 'their private reply',
      });

      await request(server)
        .get(`/api/v1/admin/email/inbound/${theirs.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(404);
    });

    it('refuses to open a tenantless message by id', async () => {
      const orphan = await seedRow({ tenantId: null, outcome: InboundEmailOutcome.UNKNOWN_UID });

      await request(server)
        .get(`/api/v1/admin/email/inbound/${orphan.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(404);
    });

    it('lets each community read its own rows on its own host', async () => {
      await seedRow({ tenantId: otherTenantId, outcome: InboundEmailOutcome.RECORDED, subject: 'theirs' });

      const res = await request(server)
        .get('/api/v1/admin/email/inbound')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      expect(res.body.rows.map((r: { subject: string }) => r.subject)).toEqual(['theirs']);
    });
  });

  describe('the operator sees every row', () => {
    it('returns rows from both communities and the ones belonging to none', async () => {
      await seedRow({ tenantId: TEST_TENANT_ID, outcome: InboundEmailOutcome.RECORDED, subject: 'mine' });
      await seedRow({ tenantId: otherTenantId, outcome: InboundEmailOutcome.RECORDED, subject: 'theirs' });
      await seedRow({ tenantId: null, outcome: InboundEmailOutcome.UNKNOWN_UID, subject: 'nobody' });

      const res = await request(server)
        .get('/api/v1/system/email/inbound')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);

      expect(res.body.total).toBe(3);
      expect(res.body.rows.map((r: { subject: string }) => r.subject).sort()).toEqual([
        'mine',
        'nobody',
        'theirs',
      ]);
    });

    it('names the community on each row, and leaves it null where there is none', async () => {
      await seedRow({ tenantId: otherTenantId, outcome: InboundEmailOutcome.RECORDED, subject: 'theirs' });
      await seedRow({ tenantId: null, outcome: InboundEmailOutcome.UNKNOWN_UID, subject: 'nobody' });

      const res = await request(server)
        .get('/api/v1/system/email/inbound')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);

      const bySubject = Object.fromEntries(
        res.body.rows.map((r: { subject: string; tenantName: string | null }) => [r.subject, r.tenantName]),
      );
      expect(bySubject.theirs).toBe('other-inbound');
      expect(bySubject.nobody).toBeNull();
    });

    it('can narrow to the rows that matched no community', async () => {
      await seedRow({ tenantId: TEST_TENANT_ID, outcome: InboundEmailOutcome.RECORDED, subject: 'mine' });
      await seedRow({ tenantId: null, outcome: InboundEmailOutcome.UNKNOWN_UID, subject: 'nobody' });

      const res = await request(server)
        .get('/api/v1/system/email/inbound?unresolvedOnly=true')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);

      expect(res.body.rows.map((r: { subject: string }) => r.subject)).toEqual(['nobody']);
    });

    it('can open a tenantless message, which is the point of the view', async () => {
      const orphan = await seedRow({
        tenantId: null,
        outcome: InboundEmailOutcome.UNKNOWN_UID,
        rawBody: 'the reply nobody could place',
      });

      const res = await request(server)
        .get(`/api/v1/system/email/inbound/${orphan.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);

      expect(res.body.raw).toBe('the reply nobody could place');
    });

    /**
     * Narrower than the per-community screen on purpose: this view carries every
     * community's mail, so a root-tenant admin who is not the operator is
     * refused -- the same split v2-32 drew for the shared report board.
     */
    it('refuses a community admin, even on the root tenant', async () => {
      await request(server)
        .get('/api/v1/system/email/inbound')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(403);
    });

    it('refuses another community\'s admin on their own host', async () => {
      await request(server)
        .get('/api/v1/system/email/inbound')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(403);
    });
  });

  describe('filters', () => {
    it('can show failures only, excluding recorded and unchanged', async () => {
      await seedRow({ tenantId: TEST_TENANT_ID, outcome: InboundEmailOutcome.RECORDED, subject: 'ok' });
      await seedRow({ tenantId: TEST_TENANT_ID, outcome: InboundEmailOutcome.UNCHANGED, subject: 'same' });
      await seedRow({ tenantId: TEST_TENANT_ID, outcome: InboundEmailOutcome.MEMBER_NOT_FOUND, subject: 'bad' });

      const res = await request(server)
        .get('/api/v1/admin/email/inbound?failuresOnly=true')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(200);

      expect(res.body.rows.map((r: { subject: string }) => r.subject)).toEqual(['bad']);
    });

    it('counts by outcome within the caller\'s own rows', async () => {
      await seedRow({ tenantId: TEST_TENANT_ID, outcome: InboundEmailOutcome.RECORDED });
      await seedRow({ tenantId: TEST_TENANT_ID, outcome: InboundEmailOutcome.RECORDED });
      await seedRow({ tenantId: otherTenantId, outcome: InboundEmailOutcome.RECORDED });

      const res = await request(server)
        .get('/api/v1/admin/email/inbound')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(200);

      // Two, not three: the summary is as scoped as the list it summarises.
      expect(res.body.byOutcome.recorded).toBe(2);
    });

    it('refuses an unknown outcome rather than returning an empty log', async () => {
      await request(server)
        .get('/api/v1/admin/email/inbound?outcome=not_a_real_outcome')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(400);
    });
  });
});
