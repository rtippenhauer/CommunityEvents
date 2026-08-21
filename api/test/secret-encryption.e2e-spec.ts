import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { TenantSecretsService } from '../src/modules/tenant-secrets/tenant-secrets.service';
import { runWithTenant } from '../src/common/tenant/tenant-store';
import { UserRole } from '../src/database/enums';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { TEST_TENANT_ID } from './setup-env';

/**
 * Prisma promises are lazy, so a query built inside `runWithTenant` and awaited
 * outside runs with no tenant. Everything here awaits within the scope.
 */
const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

/**
 * The Definition of Done for v2-7, asserted end to end.
 *
 * The claim being tested is "secrets are unreadable in a database dump", and
 * the only way to test that honestly is to look at what is actually in the
 * column — so every assertion about storage goes through `$queryRaw`, which
 * Prisma does not route through extensions and which is therefore the closest
 * thing to `mysqldump` available from inside a spec. Reading the same value
 * back through the client and getting plaintext is what proves the round trip
 * rather than just the encryption.
 */
describe('Secret encryption at rest (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: TenantResolutionService;
  let secrets: TenantSecretsService;

  const TENANT_B_ID = 2;
  const BREVO_KEY = 'xkeysib-e2e-not-a-real-brevo-key';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenants = app.get(TenantResolutionService);
    secrets = app.get(TenantSecretsService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    tenants.clearCache();

    await prisma.tenants.create({
      data: { id: TENANT_B_ID, slug: 'second', domain: 'second-community.test' },
    });

    await prisma.email_provider_config.create({
      data: { id: 1, lastResetDate: new Date('2026-08-19') },
    });
  });

  /** What is physically stored, with no extension in the way. */
  async function storedEmailKey(): Promise<string | null> {
    const [row] = await prisma.$queryRaw<{ brevo_api_key: string | null }[]>`
      SELECT brevo_api_key FROM email_provider_config WHERE id = 1`;
    return row?.brevo_api_key ?? null;
  }

  describe('email provider keys', () => {
    it('writes ciphertext and reads back plaintext', async () => {
      await prisma.email_provider_config.update({
        where: { id: 1 },
        data: { brevoApiKey: BREVO_KEY },
      });

      const stored = await storedEmailKey();
      expect(stored).toMatch(/^enc:v1:[0-9a-f]{8}:/);
      expect(stored).not.toContain(BREVO_KEY);
      // Not merely absent as a whole -- no recognisable fragment survives.
      expect(stored).not.toContain('xkeysib');

      const read = await prisma.email_provider_config.findUnique({ where: { id: 1 } });
      expect(read?.brevoApiKey).toBe(BREVO_KEY);
    });

    it('leaves an unset key unset rather than storing an encrypted empty', async () => {
      await prisma.email_provider_config.update({
        where: { id: 1 },
        data: { brevoApiKey: null },
      });
      expect(await storedEmailKey()).toBeNull();
    });

    // The migration path. A database upgraded into this code still holds
    // plaintext, and the app has to keep working until secrets:rewrap runs.
    it('still reads a legacy plaintext value written before encryption existed', async () => {
      await prisma.$executeRaw`
        UPDATE email_provider_config SET brevo_api_key = ${'legacy-plaintext-key'} WHERE id = 1`;

      const read = await prisma.email_provider_config.findUnique({ where: { id: 1 } });
      expect(read?.brevoApiKey).toBe('legacy-plaintext-key');
    });

    it('encrypts through a select as well as a full read', async () => {
      await prisma.email_provider_config.update({
        where: { id: 1 },
        data: { brevoApiKey: BREVO_KEY, resendApiKey: 're_e2e_not_a_real_key' },
      });

      const read = await prisma.email_provider_config.findUnique({
        where: { id: 1 },
        select: { resendApiKey: true },
      });
      expect(read?.resendApiKey).toBe('re_e2e_not_a_real_key');
    });
  });

  describe('per-community secrets', () => {
    it('stores each community its own key, encrypted, and resolves the right one', async () => {
      await inTenant(TEST_TENANT_ID, () => secrets.set('geocoding_api_key', 'key-for-A', 0));
      await inTenant(TENANT_B_ID, () => secrets.set('geocoding_api_key', 'key-for-B', 0));

      expect(await inTenant(TEST_TENANT_ID, () => secrets.resolve('geocoding_api_key'))).toBe(
        'key-for-A',
      );
      expect(await inTenant(TENANT_B_ID, () => secrets.resolve('geocoding_api_key'))).toBe(
        'key-for-B',
      );

      const rows = await prisma.$queryRaw<{ tenant_id: number; secret_value: string }[]>`
        SELECT tenant_id, secret_value FROM tenant_secrets ORDER BY tenant_id`;
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.secret_value).toMatch(/^enc:v1:/);
        expect(row.secret_value).not.toContain('key-for-');
      }
    });

    it('falls back to the deployment env var when a community has set nothing', async () => {
      process.env.GEOCODING_API_KEY = 'deployment-wide-key';
      try {
        expect(await inTenant(TEST_TENANT_ID, () => secrets.resolve('geocoding_api_key'))).toBe(
          'deployment-wide-key',
        );

        await inTenant(TEST_TENANT_ID, () => secrets.set('geocoding_api_key', 'own-key', 0));
        expect(await inTenant(TEST_TENANT_ID, () => secrets.resolve('geocoding_api_key'))).toBe(
          'own-key',
        );

        // Clearing returns the community to the deployment default rather than
        // to nothing -- the difference between "inherit" and "off".
        await inTenant(TEST_TENANT_ID, () => secrets.clear('geocoding_api_key'));
        expect(await inTenant(TEST_TENANT_ID, () => secrets.resolve('geocoding_api_key'))).toBe(
          'deployment-wide-key',
        );
      } finally {
        delete process.env.GEOCODING_API_KEY;
      }
    });

    it('decrypts a secret reached through a relation', async () => {
      await inTenant(TEST_TENANT_ID, () => secrets.set('places_api_key', 'via-relation', 0));

      const tenant = await prisma.tenants.findUnique({
        where: { id: TEST_TENANT_ID },
        include: { tenant_secrets: true },
      });
      expect(tenant?.tenant_secrets[0].secretValue).toBe('via-relation');
    });
  });

  // Randomised encryption means a filter on one of these columns matches
  // nothing. Returning an empty result would read as "no such key"; throwing is
  // the only answer that is not a lie.
  describe('queries that cannot work', () => {
    it('refuses to filter on an encrypted column', async () => {
      await expect(
        prisma.email_provider_config.findFirst({ where: { brevoApiKey: BREVO_KEY } }),
      ).rejects.toThrow(/encrypted at rest/);
    });

    it('refuses to order by one', async () => {
      await expect(
        prisma.email_provider_config.findMany({ orderBy: { brevoApiKey: 'asc' } }),
      ).rejects.toThrow(/Cannot order by/);
    });

    it('refuses a filter buried in an OR', async () => {
      await expect(
        prisma.email_provider_config.findFirst({
          where: { OR: [{ id: 1 }, { brevoApiKey: BREVO_KEY }] },
        }),
      ).rejects.toThrow(/encrypted at rest/);
    });
  });

  describe('over HTTP', () => {
    let adminCookie: string;

    beforeEach(async () => {
      const city = await seedCity(prisma);
      const admin = await inTenant(TEST_TENANT_ID, () =>
        seedUser(prisma, city.id, { role: UserRole.ADMIN }),
      );
      adminCookie = await loginAs(app, admin);
    });

    it('never sends the email API key to the browser', async () => {
      await prisma.email_provider_config.update({
        where: { id: 1 },
        data: { brevoApiKey: BREVO_KEY },
      });

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/email/config')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.brevoApiKey).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('xkeysib');
      expect(res.body.brevoApiKeySet).toBe(true);
    });

    it('leaves the stored key alone when a patch omits it', async () => {
      await prisma.email_provider_config.update({
        where: { id: 1 },
        data: { brevoApiKey: BREVO_KEY },
      });

      await request(app.getHttpServer())
        .patch('/api/v1/admin/email/config')
        .set('Cookie', adminCookie)
        .send({ brevoFromName: 'Renamed' })
        .expect(200);

      const read = await prisma.email_provider_config.findUnique({ where: { id: 1 } });
      expect(read?.brevoApiKey).toBe(BREVO_KEY);
      expect(read?.brevoFromName).toBe('Renamed');
    });

    it('sets and clears a community secret without ever returning it', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/admin/secrets/geocoding_api_key')
        .set('Cookie', adminCookie)
        .send({ value: 'set-over-http' })
        .expect(204);

      const listed = await request(app.getHttpServer())
        .get('/api/v1/admin/secrets')
        .set('Cookie', adminCookie)
        .expect(200);

      expect(JSON.stringify(listed.body)).not.toContain('set-over-http');
      const entry = listed.body.find(
        (row: { key: string }) => row.key === 'geocoding_api_key',
      ) as { source: string };
      expect(entry.source).toBe('tenant');

      await request(app.getHttpServer())
        .delete('/api/v1/admin/secrets/geocoding_api_key')
        .set('Cookie', adminCookie)
        .expect(204);

      expect(
        await inTenant(TEST_TENANT_ID, () => secrets.resolve('geocoding_api_key')),
      ).toBeNull();
    });

    it('rejects an unknown key rather than saving a row nothing reads', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/admin/secrets/stripe_api_key')
        .set('Cookie', adminCookie)
        .send({ value: 'anything' })
        .expect(400);
    });

    it('does not let a member set one', async () => {
      const city = await seedCity(prisma);
      const member = await inTenant(TEST_TENANT_ID, () => seedUser(prisma, city.id));
      const memberCookie = await loginAs(app, member);

      await request(app.getHttpServer())
        .put('/api/v1/admin/secrets/geocoding_api_key')
        .set('Cookie', memberCookie)
        .send({ value: 'nope' })
        .expect(403);
    });
  });
});
