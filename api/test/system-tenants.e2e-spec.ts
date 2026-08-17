import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { UserRole } from '../src/database/enums';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { loginAs, seedCity, seedUser } from './utils/seed';
import { TEST_TENANT_ID } from './setup-env';
import { runWithTenant } from '../src/common/tenant/tenant-store';

/**
 * Reads a row belonging to a *different* tenant than the ambient one.
 *
 * Necessary, not decorative: `users` is scoped, so a bare
 * `findFirst({ where: { tenantId: other } })` has the extension inject the
 * ambient tenant alongside it and throws "Refusing to run a query filtered to
 * tenant X while tenant Y is in context". Awaited inside, because Prisma
 * promises are lazy.
 */
const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

/**
 * The tenant registry, end to end (REQ-TENANT-01.7).
 *
 * Requests land on 127.0.0.1, which `seedRequestTenant` sets up as the root
 * tenant, so an authenticated system admin here is browsing the root host --
 * the arrangement SystemAdminGuard is designed for. The non-root half of the
 * guard cannot be exercised over HTTP in this suite (there is one host), so it
 * is pinned in system-admin.guard.spec.ts instead.
 */
describe('System tenant management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let systemAdminCookie: string;
  let adminCookie: string;
  let memberCookie: string;

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

    const systemAdmin = await seedUser(prisma, city.id, {
      role: UserRole.SYSTEM_ADMIN,
      email: 'sysadmin@example.test',
    });
    const admin = await seedUser(prisma, city.id, {
      role: UserRole.ADMIN,
      email: 'admin@example.test',
    });
    const member = await seedUser(prisma, city.id, { email: 'member@example.test' });

    systemAdminCookie = await loginAs(app, systemAdmin);
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
  });

  describe('access', () => {
    it('admits a system admin', async () => {
      await request(server)
        .get('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .expect(200);
    });

    // The distinction the whole module exists for: administering a community is
    // not administering the deployment. RolesGuard's hierarchy runs the other
    // way (system_admin satisfies @Roles(ADMIN)); nothing makes an admin a
    // system admin.
    it('refuses an ordinary tenant admin', async () => {
      await request(server).get('/api/v1/system/tenants').set('Cookie', adminCookie).expect(403);
    });

    it('refuses a member', async () => {
      await request(server).get('/api/v1/system/tenants').set('Cookie', memberCookie).expect(403);
    });

    it('refuses an unauthenticated request', async () => {
      await request(server).get('/api/v1/system/tenants').expect(401);
    });
  });

  describe('GET /system/tenants', () => {
    it('lists the root tenant first, with sizes', async () => {
      await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'zebra.example.test' })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].isRoot).toBe(true);
      expect(res.body[0].id).toBe(TEST_TENANT_ID);
      expect(res.body[1].slug).toBe('zebra');
      expect(res.body[1].eventCount).toBe(0);
      expect(res.body[1].locationCount).toBe(0);
    });
  });

  describe('POST /system/tenants', () => {
    it('creates a tenant, defaulting the slug to the first label', async () => {
      const res = await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'dayton.example.test' })
        .expect(201);

      expect(res.body).toMatchObject({
        slug: 'dayton',
        domain: 'dayton.example.test',
        isRoot: false,
        status: 'active',
      });
    });

    // Same normalisation the Host-header middleware applies, so a tenant created
    // here resolves by exactly the rule that later looks it up. `www.x` and `x`
    // must not become two rows.
    it('normalises the domain on the way in', async () => {
      const res = await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'WWW.Norfolk.Example.Test', slug: 'norfolk' })
        .expect(201);

      expect(res.body.domain).toBe('norfolk.example.test');
    });

    it('rejects a host that is not usable', async () => {
      await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'localhost' })
        .expect(400);
    });

    it('reports a duplicate domain as a conflict, naming it', async () => {
      await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'twice.example.test' })
        .expect(201);

      const res = await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'twice.example.test', slug: 'different' })
        .expect(409);

      expect(res.body.message).toContain('twice.example.test');
    });

    it('reports a duplicate slug as a conflict', async () => {
      await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'one.example.test', slug: 'shared' })
        .expect(201);

      await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'two.example.test', slug: 'shared' })
        .expect(409);
    });

    // is_root is not on the DTO at all, and forbidNonWhitelisted is on globally,
    // so asking for it is a validation error rather than a silently ignored
    // field. Either would be safe; this pins which one it is.
    it('refuses an attempt to create a second root tenant', async () => {
      await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'usurper.example.test', isRoot: true })
        .expect(400);

      const roots = await prisma.tenants.findMany({ where: { isRoot: true } });
      expect(roots).toHaveLength(1);
      expect(roots[0].id).toBe(TEST_TENANT_ID);
    });
  });

  describe('the first admin', () => {
    // The gap this closes, found on the first two-tenant stage test: a community
    // created without an admin cannot be signed in to by anyone. Registration
    // needs an invite, invites need an existing member, and the only other
    // account is the tenant's own `disabled` service account.
    it('creates an admin on the new community', async () => {
      const res = await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({
          domain: 'withadmin.example.test',
          adminName: 'Dana Operator',
          adminEmail: 'dana@example.test',
          adminPassword: 'P@ssw0rd-Test!',
        })
        .expect(201);

      const admin = await inTenant(res.body.id, () =>
        prisma.users.findFirst({ where: { email: 'dana@example.test' } }),
      );

      expect(admin).not.toBeNull();
      expect(admin!.role).toBe(UserRole.ADMIN);
      expect(admin!.fullName).toBe('Dana Operator');
      expect(admin!.passwordHash).toBeTruthy();
      // Verified on creation: an unverified first admin could not complete
      // verification, since there is nobody on that tenant to ask.
      expect(admin!.emailVerifiedAt).not.toBeNull();
      expect(admin!.isServiceAccount).toBe(false);
    });

    it('puts the admin on the new tenant, not the root one', async () => {
      const res = await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({
          domain: 'elsewhere.example.test',
          adminEmail: 'elsewhere-admin@example.test',
          adminPassword: 'P@ssw0rd-Test!',
        })
        .expect(201);

      const onRoot = await inTenant(TEST_TENANT_ID, () =>
        prisma.users.findFirst({ where: { email: 'elsewhere-admin@example.test' } }),
      );
      const onNew = await inTenant(res.body.id, () =>
        prisma.users.findFirst({ where: { email: 'elsewhere-admin@example.test' } }),
      );

      expect(onRoot).toBeNull();
      expect(onNew).not.toBeNull();
    });

    it('defaults the name when only credentials are given', async () => {
      const res = await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({
          domain: 'noname.example.test',
          adminEmail: 'noname@example.test',
          adminPassword: 'P@ssw0rd-Test!',
        })
        .expect(201);

      const admin = await inTenant(res.body.id, () =>
        prisma.users.findFirst({ where: { isServiceAccount: false } }),
      );
      expect(admin!.fullName).toBe('Admin');
    });

    // Still allowed, because an operator may want to stage a community before
    // deciding who runs it — but it is the case that produces an unusable
    // tenant, so the service logs a warning and the UI requires the fields.
    it('still creates the tenant when no admin is supplied', async () => {
      await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'noadmin.example.test' })
        .expect(201);
    });

    it('refuses the address reserved for the service account', async () => {
      await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({
          domain: 'reserved.example.test',
          adminEmail: 'automation@dinnerbears.internal',
          adminPassword: 'P@ssw0rd-Test!',
        })
        .expect(400);
    });

    it('rejects a weak admin password', async () => {
      await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({
          domain: 'weak.example.test',
          adminEmail: 'weak@example.test',
          adminPassword: 'short',
        })
        .expect(400);
    });
  });

  describe('the mail domain', () => {
    // Asked at creation because the operator is the only person who knows the
    // DNS behind the new domain, and because getting it wrong is invisible:
    // mail from a domain with no MX record bounces with nothing to show.
    it('stores it as a setting on the new community', async () => {
      const res = await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'mail1.example.test', mailDomain: 'mailer.example.test' })
        .expect(201);

      const row = await inTenant(res.body.id, () =>
        prisma.app_config.findFirst({ where: { configKey: 'mail_domain' } }),
      );
      expect(row?.configValue).toBe('mailer.example.test');
    });

    it('normalises a pasted URL down to a bare host', async () => {
      const res = await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'mail2.example.test', mailDomain: 'https://WWW.Mailer.example.test/x' })
        .expect(201);

      const row = await inTenant(res.body.id, () =>
        prisma.app_config.findFirst({ where: { configKey: 'mail_domain' } }),
      );
      // www is a web host and never a mail domain -- an address derived from
      // it bounces, which is the same reason the tenant domain strips it.
      expect(row?.configValue).toBe('mailer.example.test');
    });

    it('writes nothing when left blank, so the deployment default applies', async () => {
      const res = await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'mail3.example.test' })
        .expect(201);

      const row = await inTenant(res.body.id, () =>
        prisma.app_config.findFirst({ where: { configKey: 'mail_domain' } }),
      );
      // Absent, not empty-string: blank means "inherit", and AppConfigService
      // resolves that at read time rather than storing a decision.
      expect(row).toBeNull();
    });

    it('keeps it on the new community, not the root one', async () => {
      await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'mail4.example.test', mailDomain: 'mailer4.example.test' })
        .expect(201);

      const onRoot = await inTenant(TEST_TENANT_ID, () =>
        prisma.app_config.findFirst({ where: { configKey: 'mail_domain' } }),
      );
      expect(onRoot).toBeNull();
    });
  });

  describe('PATCH /system/tenants/:id', () => {
    let tenantId: number;

    beforeEach(async () => {
      const res = await request(server)
        .post('/api/v1/system/tenants')
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'editable.example.test' })
        .expect(201);
      tenantId = res.body.id;
    });

    it('updates the slug, domain and status', async () => {
      const res = await request(server)
        .patch(`/api/v1/system/tenants/${tenantId}`)
        .set('Cookie', systemAdminCookie)
        .send({ slug: 'renamed', domain: 'moved.example.test', status: 'suspended' })
        .expect(200);

      expect(res.body).toMatchObject({
        slug: 'renamed',
        domain: 'moved.example.test',
        status: 'suspended',
      });
    });

    it('404s an unknown tenant', async () => {
      await request(server)
        .patch('/api/v1/system/tenants/999999')
        .set('Cookie', systemAdminCookie)
        .send({ status: 'suspended' })
        .expect(404);
    });

    // Both of these are self-lockout guards, and they are the reason the root
    // tenant is not just another row in this UI. Suspending it makes
    // TenantMiddleware answer 503 to every request including the one that would
    // undo it; changing its domain moves the only host this API answers on, and
    // bootstrap would revert it from APP_URL on the next deploy anyway.
    it('refuses to suspend the root tenant', async () => {
      await request(server)
        .patch(`/api/v1/system/tenants/${TEST_TENANT_ID}`)
        .set('Cookie', systemAdminCookie)
        .send({ status: 'suspended' })
        .expect(400);

      const root = await prisma.tenants.findUnique({ where: { id: TEST_TENANT_ID } });
      expect(root!.status).toBe('active');
    });

    it('refuses to change the root tenant domain', async () => {
      await request(server)
        .patch(`/api/v1/system/tenants/${TEST_TENANT_ID}`)
        .set('Cookie', systemAdminCookie)
        .send({ domain: 'elsewhere.example.test' })
        .expect(400);
    });

    it('allows a no-op patch of the root tenant that changes nothing', async () => {
      await request(server)
        .patch(`/api/v1/system/tenants/${TEST_TENANT_ID}`)
        .set('Cookie', systemAdminCookie)
        .send({ slug: 'test-root' })
        .expect(200);
    });

    it('records the change in the audit log', async () => {
      await request(server)
        .patch(`/api/v1/system/tenants/${tenantId}`)
        .set('Cookie', systemAdminCookie)
        .send({ status: 'suspended' })
        .expect(200);

      const entries = await prisma.audit_log.findMany({ where: { action: 'tenant.update' } });
      expect(entries).toHaveLength(1);
      expect(entries[0].entityId).toBe(tenantId);
    });
  });

  // Suspending is the supported way to take a community offline. Deleting one
  // would mean deleting every row of 27 scoped models that reference it.
  it('exposes no delete route', async () => {
    await request(server)
      .delete('/api/v1/system/tenants/1')
      .set('Cookie', systemAdminCookie)
      .expect(404);
  });
});
