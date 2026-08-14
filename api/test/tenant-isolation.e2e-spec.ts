import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { AuditService } from '../src/modules/audit/audit.service';
import {
  runUnscoped,
  runWithTenant,
  setTestTenantFallback,
} from '../src/common/tenant/tenant-store';
import { EventStatus, UserRole } from '../src/database/enums';
import { createTestApp, truncateAllTables, TEST_TENANT_DOMAIN } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { TEST_TENANT_ID } from './setup-env';

/**
 * Enter a tenant scope and await inside it.
 *
 * Not a convenience: Prisma promises are lazy, so `runWithTenant(id, () =>
 * prisma.events.findMany())` creates the query inside the context and executes
 * it outside, once the caller awaits. These wrappers await within the scope so
 * the extension sees the tenant. See runWithTenant's own comment.
 */
const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

const unscoped = <T>(reason: string, fn: () => Promise<T>): Promise<T> =>
  runUnscoped(reason, async () => await fn());

/**
 * The Definition of Done for v2-5, asserted end to end: cross-tenant data
 * leakage is impossible even when a caller names an id that really exists.
 *
 * Two tenants share one database and one Prisma client here, which is the whole
 * point — isolation comes from the client extension and the `tenant_id` columns,
 * not from separate connections. Everything is checked at both levels, because
 * they fail differently: the Prisma-level cases pin the extension's behaviour
 * precisely, and the HTTP-level ones prove the middleware actually establishes
 * the context the extension reads, which no unit test can show.
 *
 * "Colliding ids" is the interesting case and it is deliberately constructed:
 * fixtures are created alternately so that each tenant holds rows whose ids sit
 * either side of the other's. A filter that were merely *missing* would return
 * the wrong tenant's row rather than nothing, so every negative assertion below
 * would fail loudly rather than pass vacuously.
 */
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: TenantResolutionService;

  const TENANT_B_ID = 2;
  const TENANT_B_DOMAIN = 'second-community.test';

  // Ids of equivalent fixtures in each tenant, captured per test run.
  let eventA: number;
  let eventB: number;
  let locationA: number;
  let userA: { id: number; email: string };
  let userB: { id: number; email: string };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenants = app.get(TenantResolutionService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma); // re-seeds tenant A at TEST_TENANT_ID
    tenants.clearCache();

    await prisma.tenants.create({
      data: { id: TENANT_B_ID, slug: 'second', domain: TENANT_B_DOMAIN },
    });

    // `cities` and `users` are global models (v2-6 gives users a tenant), so one
    // city and one member per tenant is a fixture convenience, not scoping.
    const city = await seedCity(prisma);

    // Interleaved on purpose so neither tenant owns a contiguous id range.
    ({ locationA, eventA, eventB, userA, userB } = await seedBothTenants(city.id));
  });

  async function seedBothTenants(cityId: number) {
    const inA = <T>(fn: () => Promise<T>) => inTenant(TEST_TENANT_ID, fn);
    const inB = <T>(fn: () => Promise<T>) => inTenant(TENANT_B_ID, fn);

    const locA = await inA(() => seedLocation(prisma, cityId, { name: 'A location' }));
    const locB = await inB(() => seedLocation(prisma, cityId, { name: 'B location' }));

    const memberA = await seedUser(prisma, cityId, { role: UserRole.ADMIN });
    const memberB = await seedUser(prisma, cityId, { role: UserRole.ADMIN });

    const evA = await inA(() =>
      prisma.events.create({
        data: {
          cityId,
          locationId: locA.id,
          locationName: 'A location',
          locationAddress: '1 A St',
          title: 'Tenant A dinner',
          eventDate: new Date('2026-09-01'),
          eventTime: new Date('1970-01-01T18:30:00Z'),
          status: EventStatus.PUBLISHED,
          publishedAt: new Date(),
          createdById: memberA.id,
        },
      }),
    );

    const evB = await inB(() =>
      prisma.events.create({
        data: {
          cityId,
          locationId: locB.id,
          locationName: 'B location',
          locationAddress: '1 B St',
          title: 'Tenant B dinner',
          eventDate: new Date('2026-09-02'),
          eventTime: new Date('1970-01-01T18:30:00Z'),
          status: EventStatus.PUBLISHED,
          publishedAt: new Date(),
          createdById: memberB.id,
        },
      }),
    );

    await inA(() => prisma.event_rsvps.create({ data: { eventId: evA.id, userId: memberA.id } }));
    await inB(() => prisma.event_rsvps.create({ data: { eventId: evB.id, userId: memberB.id } }));

    return {
      locationA: locA.id,
      locationB: locB.id,
      eventA: evA.id,
      eventB: evB.id,
      userA: { id: memberA.id, email: memberA.email },
      userB: { id: memberB.id, email: memberB.email },
    };
  }

  describe('reads', () => {
    it('returns only its own rows from findMany', async () => {
      const seenByA = await inTenant(TEST_TENANT_ID, () =>
        prisma.events.findMany({ select: { id: true } }),
      );
      const seenByB = await inTenant(TENANT_B_ID, () =>
        prisma.events.findMany({ select: { id: true } }),
      );

      expect(seenByA.map((e) => e.id)).toEqual([eventA]);
      expect(seenByB.map((e) => e.id)).toEqual([eventB]);
    });

    it('returns nothing for findUnique on another tenant’s id', async () => {
      // The row exists. Only the tenant filter makes this null.
      const found = await inTenant(TENANT_B_ID, () =>
        prisma.events.findUnique({ where: { id: eventA } }),
      );
      expect(found).toBeNull();
    });

    it('throws for findUniqueOrThrow on another tenant’s id', async () => {
      await expect(
        inTenant(TENANT_B_ID, () => prisma.events.findUniqueOrThrow({ where: { id: eventA } })),
      ).rejects.toThrow();
    });

    it('excludes the other tenant from count, aggregate and groupBy', async () => {
      const [count, aggregate, grouped] = await inTenant(TENANT_B_ID, async () => [
        await prisma.events.count(),
        await prisma.events.aggregate({ _count: { _all: true } }),
        await prisma.events.groupBy({ by: ['status'], _count: { _all: true } }),
      ]);

      expect(count).toBe(1);
      expect(aggregate._count._all).toBe(1);
      expect(grouped.reduce((total, row) => total + row._count._all, 0)).toBe(1);
    });

    it('refuses a query that names a different tenant outright', async () => {
      await expect(
        inTenant(TENANT_B_ID, () =>
          prisma.events.findMany({ where: { tenantId: TEST_TENANT_ID } }),
        ),
      ).rejects.toThrow(/Refusing to run a query filtered to tenant/);
    });
  });

  describe('relations', () => {
    it('filters a to-many include rather than following it across tenants', async () => {
      const locations = await inTenant(TENANT_B_ID, () =>
        prisma.locations.findMany({ include: { events: true } }),
      );

      expect(locations).toHaveLength(1);
      expect(locations[0].events.map((e) => e.id)).toEqual([eventB]);
    });

    it('filters relation counts, which leak totals even when rows stay hidden', async () => {
      const eventsSeenByB = await inTenant(TENANT_B_ID, () =>
        prisma.events.findMany({ include: { _count: { select: { rsvps: true } } } }),
      );

      expect(eventsSeenByB).toHaveLength(1);
      expect(eventsSeenByB[0]._count.rsvps).toBe(1);
    });

    it('will not connect a new row to another tenant’s parent', async () => {
      await expect(
        inTenant(TENANT_B_ID, () =>
          prisma.location_photos.create({
            data: {
              filePath: '/x.jpg',
              fileName: 'x.jpg',
              mimeType: 'image/jpeg',
              // Both sides use `connect` because Prisma refuses to mix a
              // checked relation input with unchecked FK scalars in one payload.
              uploader: { connect: { id: userB.id } },
              location: { connect: { id: locationA } },
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it('stamps nested creates with the tenant, not just the top-level row', async () => {
      const created = await inTenant(TENANT_B_ID, () =>
        prisma.announcements.create({
          data: {
            title: 'Nested',
            body: 'body',
            createdBy: userB.id,
            comments: { create: [{ userId: userB.id, body: 'a comment' }] },
          },
          include: { comments: true },
        }),
      );

      const comment = await unscoped('assert raw storage', () =>
        prisma.announcement_comments.findUniqueOrThrow({
          where: { id: created.comments[0].id },
        }),
      );
      expect(comment.tenantId).toBe(TENANT_B_ID);
    });
  });

  describe('writes', () => {
    it('stamps creates with the ambient tenant', async () => {
      const created = await inTenant(TENANT_B_ID, () =>
        prisma.notifications.create({
          data: { userId: userB.id, type: 'test', title: 'hello' },
        }),
      );
      expect(created.tenantId).toBe(TENANT_B_ID);
    });

    it('refuses a create that names a different tenant', async () => {
      await expect(
        inTenant(TENANT_B_ID, () =>
          prisma.notifications.create({
            data: {
              userId: userB.id,
              type: 'test',
              title: 'hello',
              tenantId: TEST_TENANT_ID,
            },
          }),
        ),
      ).rejects.toThrow(/Refusing to create a notifications row for tenant/);
    });

    it('cannot move a row to another tenant with an update', async () => {
      await expect(
        inTenant(TENANT_B_ID, () =>
          prisma.events.update({
            where: { id: eventB },
            data: { tenantId: TEST_TENANT_ID },
          }),
        ),
      ).rejects.toThrow(/not writable/);
    });

    it('does not update another tenant’s row', async () => {
      await expect(
        inTenant(TENANT_B_ID, () =>
          prisma.events.update({ where: { id: eventA }, data: { title: 'hijacked' } }),
        ),
      ).rejects.toThrow();

      const untouched = await unscoped('assert raw storage', () =>
        prisma.events.findUniqueOrThrow({ where: { id: eventA } }),
      );
      expect(untouched.title).toBe('Tenant A dinner');
    });

    it('matches nothing when updateMany names another tenant’s row', async () => {
      const result = await inTenant(TENANT_B_ID, () =>
        prisma.events.updateMany({ where: { id: eventA }, data: { title: 'hijacked' } }),
      );
      expect(result.count).toBe(0);
    });

    it('does not delete another tenant’s rows', async () => {
      const result = await inTenant(TENANT_B_ID, () => prisma.events.deleteMany({}));
      expect(result.count).toBe(1);

      const survivors = await unscoped('assert raw storage', () =>
        prisma.events.findMany({ select: { id: true } }),
      );
      expect(survivors.map((e) => e.id)).toEqual([eventA]);
    });

    it('scopes upsert, so the same key can exist once per tenant', async () => {
      // notification_preferences is unique on user_id alone, so pick a model
      // whose unique key the tenant genuinely disambiguates: member_points is
      // unique on (user_id, point_type, reference_id, tenant_id) precisely so
      // one tenant's award cannot suppress another's.
      const award = (tenantId: number) =>
        inTenant(tenantId, () =>
          prisma.member_points.create({
            data: { userId: userA.id, pointType: 'achievement', referenceId: 1, points: 1 },
          }),
        );

      await award(TEST_TENANT_ID);
      await expect(award(TENANT_B_ID)).resolves.toBeDefined();

      const rows = await unscoped('assert raw storage', () =>
        prisma.member_points.findMany({ where: { userId: userA.id } }),
      );
      expect(rows.map((r) => r.tenantId).sort()).toEqual([TEST_TENANT_ID, TENANT_B_ID]);
    });
  });

  describe('fail-closed behaviour', () => {
    it('refuses to touch a scoped model with no tenant context at all', async () => {
      // The e2e harness installs a fallback tenant so specs can seed fixtures
      // directly; clearing it restores what the running application sees.
      setTestTenantFallback(undefined);
      try {
        await expect(prisma.events.findMany()).rejects.toThrow(/No tenant context for events/);
      } finally {
        setTestTenantFallback(TEST_TENANT_ID);
      }
    });

    it('still allows global models with no tenant context', async () => {
      setTestTenantFallback(undefined);
      try {
        await expect(prisma.tenants.findMany()).resolves.toHaveLength(2);
      } finally {
        setTestTenantFallback(TEST_TENANT_ID);
      }
    });

    it('attributes a system audit entry to the root tenant rather than dropping it', async () => {
      // The scheduled sweeps run unscoped, so nothing stamps tenant_id and the
      // sentinel default would be rejected by the foreign key. Audit rows are
      // the one thing that must survive that, so they fall back to the root
      // tenant — the system-admin tenant under REQ-TENANT-01.7.
      await unscoped('system sweep', () =>
        app.get(AuditService).log({ action: 'system_test', entityType: 'test' }),
      );

      const entries = await unscoped('assert raw storage', () =>
        prisma.audit_log.findMany({ where: { action: 'system_test' } }),
      );

      expect(entries).toHaveLength(1);
      expect(entries[0].tenantId).toBe(TEST_TENANT_ID); // the seeded root tenant
    });

    it('sees every tenant inside an explicit runUnscoped waiver', async () => {
      const all = await unscoped('cross-tenant sweep', () =>
        prisma.events.findMany({ select: { id: true } }),
      );
      expect(all.map((e) => e.id).sort()).toEqual([eventA, eventB].sort());
    });
  });

  describe('over HTTP', () => {
    it('serves each host only its own events', async () => {
      const cookieA = await inTenant(TEST_TENANT_ID, () => loginAs(app, userA as never));
      const cookieB = await inTenant(TENANT_B_ID, () => loginAs(app, userB as never));

      const resA = await request(app.getHttpServer())
        .get('/api/v1/events')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', cookieA);
      const resB = await request(app.getHttpServer())
        .get('/api/v1/events')
        .set('Host', TENANT_B_DOMAIN)
        .set('Cookie', cookieB);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);

      const idsOf = (body: unknown): number[] => {
        const rows = Array.isArray(body)
          ? body
          : ((body as { data?: { id: number }[] }).data ?? []);
        return rows.map((row: { id: number }) => row.id).sort();
      };

      expect(idsOf(resA.body)).toEqual([eventA]);
      expect(idsOf(resB.body)).toEqual([eventB]);
    });

    it('404s when a host asks for an id belonging to the other tenant', async () => {
      const cookieB = await inTenant(TENANT_B_ID, () => loginAs(app, userB as never));

      // eventA exists, and is readable from tenant A's host in the test above.
      const res = await request(app.getHttpServer())
        .get(`/api/v1/events/${eventA}`)
        .set('Host', TENANT_B_DOMAIN)
        .set('Cookie', cookieB);

      expect(res.status).toBe(404);
    });

    it('serves the same id to the tenant that owns it, so the 404 is scoping and not a broken fixture', async () => {
      const cookieA = await inTenant(TEST_TENANT_ID, () => loginAs(app, userA as never));

      const res = await request(app.getHttpServer())
        .get(`/api/v1/events/${eventA}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', cookieA);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(eventA);
    });
  });
});
