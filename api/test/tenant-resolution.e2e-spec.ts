import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  truncateAllTables,
  seedRequestTenant,
  TEST_TENANT_DOMAIN,
} from './utils/test-app';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';

/**
 * Domain resolution middleware end to end (REQ-TENANT-01.2 / v2-4).
 *
 * The unit specs cover resolution and the outcome-to-status mapping in
 * isolation. What only an integration test can show is that the middleware is
 * actually *mounted* — ahead of every route, including ones that do not exist,
 * and with the health endpoint genuinely exempt. A middleware that is wired up
 * wrong fails open: every route serves, nothing 404s, and no unit test notices.
 */
describe('Tenant domain resolution (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: TenantResolutionService;

  // Any tenant-scoped route works; branding is the one the frontend calls
  // first on load, so it is the request that actually decides whether a
  // browser sees the app or the holding page.
  const SCOPED_ROUTE = '/api/v1/config/branding';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenants = app.get(TenantResolutionService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    // Resolutions are cached for a few seconds and this suite rewrites the
    // tenants table between tests, so the cache has to go with it.
    tenants.clearCache();
  });

  describe('the root domain', () => {
    it('resolves and serves the route', async () => {
      const res = await request(app.getHttpServer())
        .get(SCOPED_ROUTE)
        .set('Host', TEST_TENANT_DOMAIN);

      expect(res.status).toBe(200);
    });

    it('resolves the www. variant to the same tenant', async () => {
      // The Definition of Done, asserted over real HTTP: the column cannot
      // hold a www. prefix, so this only passes because resolution normalises
      // the Host header the same way bootstrap normalised the stored domain.
      await prisma.tenants.deleteMany({});
      await prisma.tenants.create({
        data: {
          id: 1,
          slug: 'root',
          domain: 'communityeventsproject.com',
          isRoot: true,
          rootMarker: true,
        },
      });
      tenants.clearCache();

      const bare = await request(app.getHttpServer())
        .get(SCOPED_ROUTE)
        .set('Host', 'communityeventsproject.com');
      const www = await request(app.getHttpServer())
        .get(SCOPED_ROUTE)
        .set('Host', 'www.communityeventsproject.com');

      expect(bare.status).toBe(200);
      expect(www.status).toBe(200);
    });
  });

  describe('an unrecognized domain', () => {
    it('404s with a TENANT_NOT_FOUND reason', async () => {
      const res = await request(app.getHttpServer())
        .get(SCOPED_ROUTE)
        .set('Host', 'nope.example.com');

      expect(res.status).toBe(404);
      expect(res.body.reason).toBe('TENANT_NOT_FOUND');
    });

    it('404s an unknown subdomain rather than falling back to the root tenant', async () => {
      // Sub-communities are out of scope for REQ-TENANT-01; an unknown
      // subdomain must not quietly inherit the root tenant.
      const res = await request(app.getHttpServer())
        .get(SCOPED_ROUTE)
        .set('Host', 'sub1.' + TEST_TENANT_DOMAIN);

      expect(res.status).toBe(404);
      expect(res.body.reason).toBe('TENANT_NOT_FOUND');
    });

    it('404s before the route runs, so a real path is indistinguishable from a fake one', async () => {
      // This is the check that the middleware is mounted globally rather than
      // on the routes someone remembered to list.
      const real = await request(app.getHttpServer())
        .get(SCOPED_ROUTE)
        .set('Host', 'nope.example.com');
      const fake = await request(app.getHttpServer())
        .get('/api/v1/definitely-not-a-route')
        .set('Host', 'nope.example.com');

      expect(fake.status).toBe(real.status);
      expect(fake.body.reason).toBe(real.body.reason);
      expect(fake.body.message).toBe(real.body.message);
    });

    it('404s a POST too, not just reads', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Host', 'nope.example.com')
        .send({ email: 'someone@example.com', password: 'whatever' });

      expect(res.status).toBe(404);
      expect(res.body.reason).toBe('TENANT_NOT_FOUND');
    });
  });

  describe('a deployment that was never bootstrapped', () => {
    beforeEach(async () => {
      // Migrated and seeded, but no bootstrap: the tenants table is empty.
      await prisma.tenants.deleteMany({});
      tenants.clearCache();
    });

    it('fails loudly with 503 TENANT_NOT_CONFIGURED rather than 404ing every request', async () => {
      const res = await request(app.getHttpServer())
        .get(SCOPED_ROUTE)
        .set('Host', TEST_TENANT_DOMAIN);

      expect(res.status).toBe(503);
      expect(res.body.reason).toBe('TENANT_NOT_CONFIGURED');
    });

    it('says the same thing for a host that would otherwise be unrecognized', async () => {
      // With no tenants at all there is no such thing as a recognized host,
      // and reporting "wrong domain" would send the operator hunting DNS.
      const res = await request(app.getHttpServer())
        .get(SCOPED_ROUTE)
        .set('Host', 'anything.example.com');

      expect(res.status).toBe(503);
      expect(res.body.reason).toBe('TENANT_NOT_CONFIGURED');
    });

    it('recovers once a tenant exists, without a restart', async () => {
      await seedRequestTenant(prisma);
      tenants.clearCache();

      const res = await request(app.getHttpServer())
        .get(SCOPED_ROUTE)
        .set('Host', TEST_TENANT_DOMAIN);

      expect(res.status).toBe(200);
    });
  });

  describe('a suspended tenant', () => {
    beforeEach(async () => {
      await prisma.tenants.update({ where: { id: 1 }, data: { status: 'suspended' } });
      tenants.clearCache();
    });

    it('answers 503 TENANT_SUSPENDED rather than serving the tenant', async () => {
      const res = await request(app.getHttpServer())
        .get(SCOPED_ROUTE)
        .set('Host', TEST_TENANT_DOMAIN);

      expect(res.status).toBe(503);
      expect(res.body.reason).toBe('TENANT_SUSPENDED');
    });
  });

  describe('the health endpoint', () => {
    it('answers on a recognized host and reports the tenant as ok', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Host', TEST_TENANT_DOMAIN);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', database: 'ok', tenant: 'ok' });
    });

    it('still answers on an unrecognized host, and says so', async () => {
      // The whole reason health is exempt: an operator debugging a domain
      // needs this route to describe the problem, not to be silenced by it.
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Host', 'nope.example.com');

      expect(res.status).toBe(200);
      expect(res.body.tenant).toBe('unrecognized');
      // The app itself is healthy — a stray hostname is not an outage.
      expect(res.body.status).toBe('ok');
    });

    it('reports an unbootstrapped deployment as degraded', async () => {
      await prisma.tenants.deleteMany({});
      tenants.clearCache();

      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Host', TEST_TENANT_DOMAIN);

      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ status: 'degraded', database: 'ok', tenant: 'none' });
    });

    it('reports a suspended tenant without calling the deployment unhealthy', async () => {
      await prisma.tenants.update({ where: { id: 1 }, data: { status: 'suspended' } });
      tenants.clearCache();

      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Host', TEST_TENANT_DOMAIN);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok', tenant: 'suspended' });
    });
  });
});
