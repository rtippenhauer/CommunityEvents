import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { runWithTenant } from '../src/common/tenant/tenant-store';
import { EmailStatus, UserRole, UserStatus } from '../src/database/enums';
import {
  createTestApp,
  resetThrottler,
  truncateAllTables,
  TEST_TENANT_DOMAIN,
} from './utils/test-app';
import { hashPassword, seedCity, seedUser } from './utils/seed';
import { TEST_TENANT_ID } from './setup-env';

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

/**
 * Just the `access_token=<token>` pair from a login response.
 *
 * Two traps, both of which produce a 401 that looks like a broken session:
 *
 *  - Sending the raw Set-Cookie strings straight back as a Cookie header sends
 *    their attributes too (`Path=/`, `HttpOnly`), which cookie-parser reads as
 *    further cookies.
 *  - A login response carries *three* `access_token=` entries, not one. It first
 *    clears the cookie on two different domain scopes (a leftover of the
 *    www/apex cookie-domain problem this item still has to fix) and only then
 *    sets the real one, so matching on the name alone finds an empty value.
 */
function accessTokenCookie(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[];
  const cookie = raw
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('access_token=') && c !== 'access_token=');
  if (!cookie) throw new Error('login response carried no access_token cookie');
  return cookie;
}

const TENANT_B_ID = 2;
const TENANT_B_DOMAIN = 'second-community.test';
const PASSWORD = 'P@ssw0rd-Test!';

/**
 * The Definition of Done for REQ-TENANT-01.5, asserted end to end.
 *
 * One address, two communities, two genuinely separate accounts — and login
 * resolving against the tenant that owns the URL the credentials were submitted
 * to. This is the property that could not be tested before v2-6, and the reason
 * two-tenant testing on stage was blocked: while `users` was global, any account
 * authenticated against any host.
 */
describe('User tenant scoping (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let cityId: number;

  const SHARED_EMAIL = 'same-person@example.test';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // /auth/login carries a tight per-route @Throttle and this spec logs in
    // several times per test; without a reset the later cases 429 on limits
    // that have nothing to do with what they assert.
    resetThrottler(app);
    await truncateAllTables(prisma);
    await prisma.tenants.create({
      data: { id: TENANT_B_ID, slug: 'second', domain: TENANT_B_DOMAIN },
    });
    const city = await seedCity(prisma);
    cityId = city.id;
  });

  async function seedMemberIn(tenantId: number, email: string, fullName: string) {
    return inTenant(tenantId, async () =>
      seedUser(prisma, cityId, {
        email,
        fullName,
        role: UserRole.MEMBER,
        status: UserStatus.ACTIVE,
        emailStatus: EmailStatus.ACTIVE,
        passwordHash: await hashPassword(PASSWORD),
      }),
    );
  }

  describe('email uniqueness', () => {
    it('allows the same address to hold an account in two communities', async () => {
      const a = await seedMemberIn(TEST_TENANT_ID, SHARED_EMAIL, 'Ada in A');
      const b = await seedMemberIn(TENANT_B_ID, SHARED_EMAIL, 'Ada in B');

      expect(a.id).not.toBe(b.id);
      expect(a.tenantId).toBe(TEST_TENANT_ID);
      expect(b.tenantId).toBe(TENANT_B_ID);
    });

    // The other half of the constraint, and the half that must not regress:
    // per-tenant uniqueness is not "no uniqueness".
    it('still refuses a duplicate address within one community', async () => {
      await seedMemberIn(TEST_TENANT_ID, SHARED_EMAIL, 'Ada in A');

      await expect(seedMemberIn(TEST_TENANT_ID, SHARED_EMAIL, 'Impostor')).rejects.toThrow();
    });

    it('keeps the two accounts fully independent', async () => {
      const a = await seedMemberIn(TEST_TENANT_ID, SHARED_EMAIL, 'Ada in A');
      await seedMemberIn(TENANT_B_ID, SHARED_EMAIL, 'Ada in B');

      // Promoting the account in one community must not touch the other's.
      await inTenant(TEST_TENANT_ID, async () => {
        await prisma.users.update({ where: { id: a.id }, data: { role: UserRole.ADMIN } });
      });

      const inB = await inTenant(TENANT_B_ID, async () =>
        prisma.users.findFirst({ where: { email: SHARED_EMAIL } }),
      );
      expect(inB!.role).toBe(UserRole.MEMBER);
      expect(inB!.fullName).toBe('Ada in B');
    });
  });

  describe('login resolves against the host', () => {
    beforeEach(async () => {
      await seedMemberIn(TEST_TENANT_ID, SHARED_EMAIL, 'Ada in A');
      await seedMemberIn(TENANT_B_ID, SHARED_EMAIL, 'Ada in B');
    });

    it('signs in as the account belonging to the requested host', async () => {
      const resA = await request(server)
        .post('/api/v1/auth/login')
        .set('Host', TEST_TENANT_DOMAIN)
        .send({ email: SHARED_EMAIL, password: PASSWORD })
        .expect(200);

      const meA = await request(server)
        .get('/api/v1/auth/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', accessTokenCookie(resA))
        .expect(200);

      expect(meA.body.fullName).toBe('Ada in A');
    });

    it('signs in as the other community’s account on the other host', async () => {
      const resB = await request(server)
        .post('/api/v1/auth/login')
        .set('Host', TENANT_B_DOMAIN)
        .send({ email: SHARED_EMAIL, password: PASSWORD })
        .expect(200);

      const meB = await request(server)
        .get('/api/v1/auth/me')
        .set('Host', TENANT_B_DOMAIN)
        .set('Cookie', accessTokenCookie(resB))
        .expect(200);

      expect(meB.body.fullName).toBe('Ada in B');
    });

    // The account exists, and the password is right — but not here. Before v2-6
    // this succeeded, because `users` was global and the host was irrelevant.
    it('refuses an address that has no account on this host', async () => {
      await request(server)
        .post('/api/v1/auth/login')
        .set('Host', TENANT_B_DOMAIN)
        .send({ email: 'only-in-a@example.test', password: PASSWORD })
        .expect(401);

      await seedMemberIn(TEST_TENANT_ID, 'only-in-a@example.test', 'A only');

      await request(server)
        .post('/api/v1/auth/login')
        .set('Host', TENANT_B_DOMAIN)
        .send({ email: 'only-in-a@example.test', password: PASSWORD })
        .expect(401);

      await request(server)
        .post('/api/v1/auth/login')
        .set('Host', TEST_TENANT_DOMAIN)
        .send({ email: 'only-in-a@example.test', password: PASSWORD })
        .expect(200);
    });
  });

  describe('the session cookie is host-only', () => {
    beforeEach(async () => {
      await seedMemberIn(TEST_TENANT_ID, SHARED_EMAIL, 'Ada in A');
      await seedMemberIn(TENANT_B_ID, SHARED_EMAIL, 'Ada in B');
    });

    // The security property, asserted on the wire rather than in the options
    // object: a Domain attribute here would make one login valid on every
    // community, since a tenant *is* a domain under v2.
    it('sets no Domain attribute on the session cookie', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .set('Host', TEST_TENANT_DOMAIN)
        .send({ email: SHARED_EMAIL, password: PASSWORD })
        .expect(200);

      const raw = res.headers['set-cookie'] as unknown as string[];
      const issued = raw.find(
        (c) => c.startsWith('access_token=') && !c.startsWith('access_token=;'),
      );

      expect(issued).toBeDefined();
      expect(issued!.toLowerCase()).not.toContain('domain=');
    });

    // Belt and braces on top of the cookie scope: even if a cookie did travel,
    // JwtStrategy resolves the session through `login_sessions`, which is
    // tenant-scoped, so tenant A's token names a session tenant B cannot see.
    it('refuses a session issued by another community', async () => {
      const resA = await request(server)
        .post('/api/v1/auth/login')
        .set('Host', TEST_TENANT_DOMAIN)
        .send({ email: SHARED_EMAIL, password: PASSWORD })
        .expect(200);

      await request(server)
        .get('/api/v1/auth/me')
        .set('Host', TENANT_B_DOMAIN)
        .set('Cookie', accessTokenCookie(resA))
        .expect(401);
    });

    // The migration path. Sessions issued before v2-6 hold a domain-scoped
    // cookie that a host-only Set-Cookie cannot overwrite, so login has to
    // explicitly clear it or it outlives the change by up to seven days.
    it('clears the legacy domain-scoped cookie on login', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .set('Host', TEST_TENANT_DOMAIN)
        .send({ email: SHARED_EMAIL, password: PASSWORD })
        .expect(200);

      const raw = res.headers['set-cookie'] as unknown as string[];
      const clears = raw.filter((c) => c.startsWith('access_token=;'));

      expect(clears.some((c) => c.toLowerCase().includes('domain='))).toBe(true);
    });
  });

  describe('app_config is per tenant', () => {
    it('lets two communities hold the same key with different values', async () => {
      await inTenant(TEST_TENANT_ID, async () => {
        await prisma.app_config.create({
          data: { configKey: 'brand_name', configValue: 'Community A' },
        });
      });
      await inTenant(TENANT_B_ID, async () => {
        await prisma.app_config.create({
          data: { configKey: 'brand_name', configValue: 'Community B' },
        });
      });

      const a = await inTenant(TEST_TENANT_ID, async () =>
        prisma.app_config.findFirst({ where: { configKey: 'brand_name' } }),
      );
      const b = await inTenant(TENANT_B_ID, async () =>
        prisma.app_config.findFirst({ where: { configKey: 'brand_name' } }),
      );

      expect(a!.configValue).toBe('Community A');
      expect(b!.configValue).toBe('Community B');
    });
  });

  describe('oauth_accounts are per tenant', () => {
    // Globally unique would have meant the first community to claim a provider
    // account owned it everywhere — the same person told their own Google login
    // was already taken when joining a second community.
    it('lets one provider account link in two communities', async () => {
      const a = await seedMemberIn(TEST_TENANT_ID, 'oauth@example.test', 'Ada in A');
      const b = await seedMemberIn(TENANT_B_ID, 'oauth@example.test', 'Ada in B');

      await inTenant(TEST_TENANT_ID, async () => {
        await prisma.oauth_accounts.create({
          data: { userId: a.id, provider: 'google', providerId: 'google-12345' },
        });
      });

      await expect(
        inTenant(TENANT_B_ID, async () => {
          await prisma.oauth_accounts.create({
            data: { userId: b.id, provider: 'google', providerId: 'google-12345' },
          });
        }),
      ).resolves.not.toThrow();
    });

    it('still refuses the same provider account twice in one community', async () => {
      const a = await seedMemberIn(TEST_TENANT_ID, 'oauth-dupe@example.test', 'Ada');

      await inTenant(TEST_TENANT_ID, async () => {
        await prisma.oauth_accounts.create({
          data: { userId: a.id, provider: 'google', providerId: 'google-999' },
        });
      });

      await expect(
        inTenant(TEST_TENANT_ID, async () => {
          await prisma.oauth_accounts.create({
            data: { userId: a.id, provider: 'google', providerId: 'google-999' },
          });
        }),
      ).rejects.toThrow();
    });
  });

  describe('the sentinel still fails closed', () => {
    // The DEFAULT 0 on users.tenant_id keeps `tenantId` optional in Prisma's
    // generated create input so the extension can supply it. Nothing may
    // actually persist a 0: tenants.id is AUTO_INCREMENT and never 0, so the
    // foreign key rejects it. A create that escapes the extension therefore dies
    // at the database rather than writing a row belonging to nobody.
    it('rejects a user row written with no tenant at all', async () => {
      // Raw SQL on purpose: it is the one path the extension does not touch, so
      // it is the closest thing to "a create that escaped scoping".
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO users (tenant_id, full_name, email, city_id, role, status)
           VALUES (0, 'Nobody', 'nobody@example.test', ?, 'member', 'active')`,
          cityId,
        ),
      ).rejects.toThrow();
    });
  });
});
