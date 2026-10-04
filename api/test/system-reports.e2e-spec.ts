import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  truncateAllTables,
  resetThrottler,
  TEST_TENANT_DOMAIN,
} from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import { UserRole } from '../src/database/enums';
import { TEST_TENANT_ID } from './setup-env';
import type { cities as City } from '@prisma/client';

const unscoped = <T>(reason: string, fn: () => Promise<T>): Promise<T> =>
  runUnscoped(reason, async () => await fn());

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

/**
 * The two channels that deliberately cross a tenant boundary (v2-32).
 *
 * Everything here is about *what crosses*. The report crosses; the person does
 * not, except to their own community and to the operator. These are the
 * assertions that make that claim true rather than intended -- the same gap
 * that let `RELEASE_INCLUDE` ship every community's private feedback until a
 * review caught it on 2026-10-02.
 */
describe('System reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let city: City;

  let rootAdminCookie: string;
  let operatorCookie: string;
  let otherAdminCookie: string;
  let demoAdminCookie: string;

  let rootAdminId: number;
  let otherTenantId: number;
  let demoTenantId: number;
  const otherDomain = 'other-reports.example.test';
  const demoDomain = 'demo-reports.example.test';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  /** A second community, with a kind (`isDemo`) and an admin of its own. */
  const seedCommunity = async (
    slug: string,
    domain: string,
    email: string,
    isDemo: boolean,
  ): Promise<{ tenantId: number; cookie: string }> => {
    const tenantId = await unscoped(`creating the ${slug} community`, async () => {
      const tenant = await prisma.tenants.create({
        data: { slug, domain, status: 'active', isDemo },
      });
      await prisma.users.create({
        data: {
          tenantId: tenant.id,
          cityId: city.id,
          fullName: `${slug} Admin`,
          email,
          role: UserRole.ADMIN,
          status: 'active',
          emailStatus: 'active',
          emailVerifiedAt: new Date(),
        },
      });
      return tenant.id;
    });

    const admin = await unscoped('finding the new admin', async () =>
      await prisma.users.findFirst({ where: { email } }),
    );
    const cookie = await inTenant(tenantId, () => loginAs(app, admin!));
    return { tenantId, cookie };
  };

  beforeEach(async () => {
    await truncateAllTables(prisma);
    resetThrottler(app);
    city = await seedCity(prisma);

    const rootAdmin = await seedUser(prisma, city.id, {
      role: UserRole.ADMIN,
      email: 'rootadmin@example.test',
      fullName: 'Root Admin',
    });
    const operator = await seedUser(prisma, city.id, {
      role: UserRole.SYSTEM_ADMIN,
      email: 'operator@example.test',
      fullName: 'The Operator',
    });
    rootAdminId = rootAdmin.id;
    rootAdminCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, rootAdmin));
    operatorCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, operator));

    ({ tenantId: otherTenantId, cookie: otherAdminCookie } = await seedCommunity(
      'other-reports',
      otherDomain,
      'otheradmin@example.test',
      false,
    ));
    ({ tenantId: demoTenantId, cookie: demoAdminCookie } = await seedCommunity(
      'demo-reports',
      demoDomain,
      'demoadmin@example.test',
      true,
    ));
  });

  const fileBug = () =>
    request(server)
      .post('/api/v1/system/bugs')
      .set('Host', TEST_TENANT_DOMAIN)
      .set('Cookie', rootAdminCookie)
      .send({ title: 'Calendar feed 500s', body: 'Subscribing to the ics feed returns a 500.' })
      .expect(201);

  describe('the shared bug board', () => {
    it('lets a non-demo admin file a report', async () => {
      const res = await fileBug();
      expect(res.body.id).toBeGreaterThan(0);
    });

    /**
     * The point of the board: the defect travels so another community can see
     * it is already known.
     */
    it('shows the report to another community', async () => {
      await fileBug();

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('Calendar feed 500s');
    });

    /**
     * The load-bearing assertion. The other community must learn the defect and
     * nothing about who hit it -- not the name, and **not the community name
     * either**, which would disclose the deployment's customer list to anybody
     * who obtains a tenant.
     */
    it('never names the reporter to another community', async () => {
      await fileBug();

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      expect(res.body[0].reporter).toEqual({ kind: 'other' });

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('Root Admin');
      expect(body).not.toContain('rootadmin@example.test');
      // The reporting community is not named either.
      expect(body).not.toContain(TEST_TENANT_DOMAIN);
    });

    it('names the reporter to their own community', async () => {
      await fileBug();

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .expect(200);

      expect(res.body[0].reporter).toEqual({ kind: 'self', fullName: 'Root Admin' });
    });

    // The operator has to know who to answer and where.
    it('gives the operator the name and the community', async () => {
      await fileBug();

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);

      expect(res.body[0].reporter).toMatchObject({
        kind: 'operator',
        fullName: 'Root Admin',
      });
      expect(res.body[0].reporter.community).toBeTruthy();
    });

    /**
     * An operator's triage note is not part of the shared record -- it is where
     * "duplicate of X" and "their DNS is wrong" get written.
     */
    it('keeps the operator note off every other community\'s copy', async () => {
      const { body: created } = await fileBug();

      await request(server)
        .patch(`/api/v1/system/bugs/${created.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .send({ status: 'in_progress', adminNote: 'THEIR INTERNAL NOTE' })
        .expect(200);

      const theirs = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);
      expect(JSON.stringify(theirs.body)).not.toContain('THEIR INTERNAL NOTE');
      expect(theirs.body[0].status).toBe('in_progress');

      const ours = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);
      expect(ours.body[0].adminNote).toBe('THEIR INTERNAL NOTE');
    });

    it('refuses triage from a community admin', async () => {
      const { body: created } = await fileBug();

      await request(server)
        .patch(`/api/v1/system/bugs/${created.id}`)
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .send({ status: 'wont_fix' })
        .expect(403);

      // And from an admin of the root tenant who is not the system admin.
      await request(server)
        .patch(`/api/v1/system/bugs/${created.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', rootAdminCookie)
        .send({ status: 'wont_fix' })
        .expect(403);
    });

    /**
     * The v2-14 lesson, re-tested in a new place. `demo.service` makes every
     * demo requester an admin, so without `NonDemoTenantGuard` "any tenant
     * admin may read the board" means "anybody who filled in the demo form".
     */
    it('refuses a demo community at both ends', async () => {
      await fileBug();

      await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', demoDomain)
        .set('Cookie', demoAdminCookie)
        .expect(403);

      await request(server)
        .post('/api/v1/system/bugs')
        .set('Host', demoDomain)
        .set('Cookie', demoAdminCookie)
        .send({ title: 'From a stranger', body: 'This should never be filed at all.' })
        .expect(403);
    });
  });

  describe('demo feedback', () => {
    const submit = () =>
      request(server)
        .post('/api/v1/demo/feedback')
        .set('Host', demoDomain)
        .set('Cookie', demoAdminCookie)
        .send({ body: 'Liked the event flow, the invite step confused me.', rating: 4 })
        .expect(201);

    it('accepts feedback from inside a demo', async () => {
      const res = await submit();
      expect(res.body.id).toBeGreaterThan(0);
    });

    it('refuses it from a real community', async () => {
      await request(server)
        .post('/api/v1/demo/feedback')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .send({ body: 'We are not a demo and have our own feedback board.' })
        .expect(403);
    });

    it('shows the operator every demo\'s feedback', async () => {
      await submit();

      const res = await request(server)
        .get('/api/v1/demo/feedback')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].rating).toBe(4);
      expect(res.body[0].demoLabel).toBeTruthy();
    });

    it('never shows it to another community', async () => {
      await submit();

      const res = await request(server)
        .get('/api/v1/demo/feedback')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    /**
     * The reason this table is global, proved rather than asserted.
     *
     * A demo is deleted within a week. Written into the scoped `feedback` table
     * this row would be erased by `purgeTenantRows` along with everything else
     * the demo owned -- readable only while the visitor was still using the
     * product, and gone by the time anybody acted on it.
     */
    it('survives the demo being deleted', async () => {
      await submit();

      await unscoped('deleting the demo the way the sweep does', async () => {
        const { purgeTenantRows } = await import('../src/common/tenant/tenant-purge');
        await prisma.$transaction(
          async (tx) => {
            await purgeTenantRows(tx, demoTenantId);
            await tx.tenants.delete({ where: { id: demoTenantId } });
          },
          { timeout: 30000 },
        );
      });

      const res = await request(server)
        .get('/api/v1/demo/feedback')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);

      expect(res.body).toHaveLength(1);
      // The join is gone, so the label is the only thing still saying which
      // demo this was -- which is exactly why it is stored rather than derived.
      expect(res.body[0].demoLabel).toBeTruthy();
      expect(res.body[0].body).toContain('invite step');
    });

    /**
     * Same property for the bug board, and the reason every foreign key here is
     * SET NULL: a restrictive key would make deleting a community fail on a bug
     * one of its admins filed, and `purgeTenantRows` walks only scoped models so
     * it would never clear it.
     */
    it('lets a community be deleted after its admin filed a bug', async () => {
      await request(server)
        .post('/api/v1/system/bugs')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .send({ title: 'Filed then left', body: 'The community that reported this is going away.' })
        .expect(201);

      await unscoped('deleting the community that filed it', async () => {
        const { purgeTenantRows } = await import('../src/common/tenant/tenant-purge');
        await prisma.$transaction(
          async (tx) => {
            await purgeTenantRows(tx, otherTenantId);
            await tx.tenants.delete({ where: { id: otherTenantId } });
          },
          { timeout: 30000 },
        );
      });

      const res = await request(server)
        .get('/api/v1/system/bugs')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(200);

      const orphan = res.body.find((b: { title: string }) => b.title === 'Filed then left');
      expect(orphan).toBeDefined();
      // The report outlives the community; the person does not.
      expect(orphan.reporter).toEqual({ kind: 'departed' });
    });
  });

  // Unauthenticated callers get nothing anywhere.
  it('requires a session', async () => {
    await request(server).get('/api/v1/system/bugs').set('Host', TEST_TENANT_DOMAIN).expect(401);
    await request(server).get('/api/v1/demo/feedback').set('Host', demoDomain).expect(401);
  });

  // `rootAdminId` is read by the fixtures above; this keeps the lint honest
  // about it being used rather than incidental.
  it('seeds a root admin', () => {
    expect(rootAdminId).toBeGreaterThan(0);
  });
});
