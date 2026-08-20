import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { TEST_TENANT_ID } from './setup-env';

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

const TENANT_B_ID = 2;
const TENANT_B_DOMAIN = 'second-community.test';

/**
 * Links that leave the application have to point at the community they belong
 * to (REQ-TENANT-01.5).
 *
 * Every one of them — verification and reset emails, invite links, event links,
 * calendar feeds — used to be built from the single `APP_URL` env var. That was
 * fine while there was one host. v2-6 turned it from a cosmetic problem into a
 * broken flow: the token lookups behind those links are tenant-scoped now, so a
 * link that lands a member on another community's host finds no token, and a
 * member of a non-root tenant could not verify an address, reset a password or
 * redeem an invite at all.
 */
describe('Tenant-aware links (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: TenantResolutionService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenants = app.get(TenantResolutionService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    await prisma.tenants.create({
      data: { id: TENANT_B_ID, slug: 'second', domain: TENANT_B_DOMAIN },
    });
    tenants.clearCache();
  });

  it('builds a URL on the ambient tenant host', async () => {
    const url = await inTenant(TENANT_B_ID, () => tenants.baseUrlFor());
    expect(url).toBe(`http://${TENANT_B_DOMAIN}`);
  });

  it('gives each tenant its own host', async () => {
    const a = await inTenant(TEST_TENANT_ID, () => tenants.baseUrlFor());
    const b = await inTenant(TENANT_B_ID, () => tenants.baseUrlFor());

    expect(a).not.toBe(b);
    expect(b).toContain(TENANT_B_DOMAIN);
  });

  // The reminder sweeps run under runUnscoped and mail several tenants' members
  // in one pass, so they cannot rely on an ambient tenant — each message takes
  // the URL from its own row.
  it('accepts an explicit tenant inside an unscoped sweep', async () => {
    const url = await runUnscoped('sweep', async () => await tenants.baseUrlFor(TENANT_B_ID));
    expect(url).toBe(`http://${TENANT_B_DOMAIN}`);
  });

  // Called from inside email composition, where throwing would mean an unsent
  // password-reset mail. A link to the wrong host is the better failure, but it
  // must be loud rather than silent — hence the error log the service writes.
  it('falls back rather than throwing when there is no tenant at all', async () => {
    const url = await runUnscoped('sweep with no explicit tenant', async () =>
      await tenants.baseUrlFor(),
    );
    expect(url).toBeTruthy();
  });

  it('picks up a domain change once the cache is cleared', async () => {
    const before = await inTenant(TENANT_B_ID, () => tenants.baseUrlFor());
    expect(before).toContain(TENANT_B_DOMAIN);

    await prisma.tenants.update({
      where: { id: TENANT_B_ID },
      data: { domain: 'renamed-community.test' },
    });
    tenants.clearCache();

    const after = await inTenant(TENANT_B_ID, () => tenants.baseUrlFor());
    expect(after).toBe('http://renamed-community.test');
  });

  // The scheme is a property of the deployment (is it behind TLS), the host is a
  // property of the tenant. Only the second is per-tenant.
  it('keeps the scheme from APP_URL', async () => {
    const url = await inTenant(TENANT_B_ID, () => tenants.baseUrlFor());
    expect(url.startsWith('http://')).toBe(true);
  });
});
