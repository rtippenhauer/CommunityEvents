import { INestApplication } from '@nestjs/common';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { normalizeTenantDomain } from '../src/common/utils/tenant-domain.util';

/**
 * The `tenants` table itself (REQ-TENANT-01.1). There is no HTTP surface for
 * tenants yet — domain resolution is REQ-TENANT-01.2 / v2-4 — so what is worth
 * asserting here is the shape of the table and the guarantees the *database*
 * makes, which is why these live in the integration suite rather than the unit
 * one. A constraint that only holds because application code remembers to
 * honour it is not a constraint.
 */
describe('Tenants table (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
  });

  const rootTenant = () => ({
    slug: 'root',
    domain: 'communityeventsproject.com',
    isRoot: true,
    rootMarker: true,
  });

  describe('defaults', () => {
    it('creates a tenant with sensible defaults', async () => {
      const tenant = await prisma.tenants.create({
        data: { slug: 'demo', domain: 'demo.communityeventsproject.com' },
      });

      expect(tenant.isRoot).toBe(false);
      expect(tenant.rootMarker).toBeNull();
      expect(tenant.status).toBe('active');
      // Reserved for a future dedicated-database option; every tenant shares
      // one database today.
      expect(tenant.dbMode).toBe('shared');
      expect(tenant.createdAt).toBeInstanceOf(Date);
    });

    it('defaults the reserved OAuth credential columns to null', async () => {
      // Null means "use the platform's own OAuth apps" and is currently the
      // only supported value (REQ-TENANT-01.8).
      const tenant = await prisma.tenants.create({
        data: { slug: 'demo', domain: 'demo.communityeventsproject.com' },
      });

      expect(tenant.googleClientId).toBeNull();
      expect(tenant.googleClientSecret).toBeNull();
      expect(tenant.facebookAppId).toBeNull();
      expect(tenant.facebookAppSecret).toBeNull();
    });
  });

  describe('exactly one root tenant', () => {
    it('accepts the first root tenant', async () => {
      const tenant = await prisma.tenants.create({ data: rootTenant() });
      expect(tenant.isRoot).toBe(true);
    });

    it('rejects a second root tenant at the database level', async () => {
      await prisma.tenants.create({ data: rootTenant() });

      // Different slug, different domain — the only thing that collides is
      // root_marker, and that is the point. Without this index the insert
      // would succeed and the instance would have two system admins.
      await expect(
        prisma.tenants.create({
          data: {
            slug: 'impostor',
            domain: 'impostor.example.test',
            isRoot: true,
            rootMarker: true,
          },
        }),
      ).rejects.toThrow();
    });

    it('allows any number of non-root tenants alongside the root', async () => {
      // The unique index must not constrain ordinary tenants: MySQL permits
      // repeated NULLs, which is what makes this work at all.
      await prisma.tenants.create({ data: rootTenant() });
      await prisma.tenants.create({ data: { slug: 'a', domain: 'a.example.test' } });
      await prisma.tenants.create({ data: { slug: 'b', domain: 'b.example.test' } });
      await prisma.tenants.create({ data: { slug: 'c', domain: 'c.example.test' } });

      expect(await prisma.tenants.count()).toBe(4);
      expect(await prisma.tenants.count({ where: { isRoot: true } })).toBe(1);
    });

    it('lets a root tenant be replaced once the first is removed', async () => {
      // Re-pointing an instance at a new root domain has to be possible; the
      // constraint is "at most one at a time", not "one forever".
      const first = await prisma.tenants.create({ data: rootTenant() });
      await prisma.tenants.delete({ where: { id: first.id } });

      const second = await prisma.tenants.create({
        data: { slug: 'root2', domain: 'other.example.test', isRoot: true, rootMarker: true },
      });
      expect(second.isRoot).toBe(true);
    });
  });

  describe('uniqueness', () => {
    it('rejects a duplicate domain', async () => {
      await prisma.tenants.create({ data: { slug: 'a', domain: 'shared.example.test' } });
      await expect(
        prisma.tenants.create({ data: { slug: 'b', domain: 'shared.example.test' } }),
      ).rejects.toThrow();
    });

    it('rejects a duplicate slug', async () => {
      await prisma.tenants.create({ data: { slug: 'dupe', domain: 'a.example.test' } });
      await expect(
        prisma.tenants.create({ data: { slug: 'dupe', domain: 'b.example.test' } }),
      ).rejects.toThrow();
    });
  });

  describe('www. and the apex are one tenant, never two', () => {
    it('stores the normalised form, so the www. variant collides on the unique index', async () => {
      // The requirement is that the two forms never become separate rows.
      // Because the column only ever holds the normalised form, an attempt to
      // add the www. variant is a duplicate rather than a second tenant.
      await prisma.tenants.create({
        data: { slug: 'root', domain: normalizeTenantDomain('https://www.example.test') },
      });

      await expect(
        prisma.tenants.create({
          data: { slug: 'root-www', domain: normalizeTenantDomain('https://example.test') },
        }),
      ).rejects.toThrow();
    });

    it('finds the tenant from either form once normalised', async () => {
      // Stands in for what the Host-header middleware will do in v2-4.
      const created = await prisma.tenants.create({
        data: { slug: 'root', domain: normalizeTenantDomain('https://www.example.test') },
      });

      for (const host of ['example.test', 'www.example.test', 'WWW.Example.Test', 'example.test:8081']) {
        const found = await prisma.tenants.findUnique({
          where: { domain: normalizeTenantDomain(host) },
        });
        expect(found?.id).toBe(created.id);
      }
    });
  });
});
