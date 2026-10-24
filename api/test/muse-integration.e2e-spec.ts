import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  truncateAllTables,
  resetThrottler,
  TEST_TENANT_DOMAIN,
} from './utils/test-app';
import { seedCity, seedUser, seedServiceAccount, seedLocation, loginAs } from './utils/seed';
import { toDateColumn, toTimeColumn } from '../src/common/utils/prisma-date.util';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import { UserRole, UserStatus } from '../src/database/enums';
import { hashToken } from '../src/modules/integrations/api-token.service';
import { TEST_TENANT_ID } from './setup-env';
import type { cities as City } from '@prisma/client';

const unscoped = <T>(reason: string, fn: () => Promise<T>): Promise<T> =>
  runUnscoped(reason, async () => await fn());

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

/**
 * Muse integration accounts and their tokens (v2-29).
 *
 * This suite exists for three claims that are made in prose elsewhere in the
 * item and would otherwise rest on reasoning alone:
 *
 *  1. **A Muse token cannot reach `OperatorGuard`.** `is_service_account` now
 *     marks a *class* of account rather than one row, and that guard grants
 *     deployment-operator rights on the column alone. The argument that it is
 *     unreachable -- nothing can mint a session for one of these accounts, and
 *     a token opens only `/muse` -- is exactly the kind that stays true until
 *     somebody adds a route. Pinned here instead.
 *  2. **The token names the community, not the Host header.** Which means a
 *     token presented on another community's host serves its *own* rows, and
 *     reaches none of the host's.
 *  3. **Flipping the role is the off switch.** `MuseTokenGuard` requires `muse`
 *     as currently held, so moving the account to `automation` for testing
 *     disables its token -- v1's behaviour, deliberately kept.
 *
 * Two communities throughout, because a check where one side happens to be
 * empty looks identical to a passing one -- the trap `v2-34` recorded when its
 * visibility split was verified on stage.
 */
describe('Muse integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let city: City;

  let adminCookie: string;
  let operatorCookie: string;
  let otherTenantId: number;
  let otherDomain: string;
  let otherAdminCookie: string;

  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
    prisma = created.prisma;
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    resetThrottler(app);

    city = await seedCity(prisma);

    const admin = await seedUser(prisma, city.id, {
      email: 'admin@example.test',
      role: UserRole.ADMIN,
    });
    adminCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, admin));

    // The operator: the root tenant's service account, which is what
    // OperatorGuard accepts whatever role it is currently wearing.
    const operator = await seedServiceAccount(prisma, city.id);
    operatorCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, operator));

    otherDomain = 'other-muse.example.test';
    otherTenantId = await unscoped('creating a second community', async () => {
      const tenant = await prisma.tenants.create({
        data: { slug: 'other-muse', domain: otherDomain, status: 'active' },
      });
      const otherAdmin = await prisma.users.create({
        data: {
          tenantId: tenant.id,
          cityId: city.id,
          fullName: 'Other Admin',
          email: 'otheradmin@example.test',
          role: UserRole.ADMIN,
          status: UserStatus.ACTIVE,
          emailStatus: 'active',
        },
      });
      otherAdminCookie = await inTenant(tenant.id, () => loginAs(app, otherAdmin));
      return tenant.id;
    });
  });

  /** Creates an integration account over HTTP, as an admin of `domain`. */
  const createAccount = async (
    name: string,
    domain = TEST_TENANT_DOMAIN,
    cookie = adminCookie,
  ): Promise<{ id: number; email: string }> => {
    const res = await request(server)
      .post('/api/v1/admin/integrations')
      .set('Host', domain)
      .set('Cookie', cookie)
      .send({ name })
      .expect(201);
    return res.body;
  };

  /** Issues a token and returns the plaintext. */
  const issueToken = async (
    userId: number,
    domain = TEST_TENANT_DOMAIN,
    cookie = adminCookie,
  ): Promise<string> => {
    const res = await request(server)
      .post(`/api/v1/admin/integrations/${userId}/tokens`)
      .set('Host', domain)
      .set('Cookie', cookie)
      .send()
      .expect(201);
    return res.body.token;
  };

  describe('the account', () => {
    it('is created as a non-person account holding the muse role', async () => {
      const account = await createAccount('Muse');

      const row = await inTenant(TEST_TENANT_ID, () =>
        prisma.users.findFirstOrThrow({ where: { id: account.id } }),
      );

      expect(row.role).toBe(UserRole.MUSE);
      expect(row.isServiceAccount).toBe(true);
      // The address can never receive mail (RFC 2606 reserved TLD), and the
      // NULL hash is what makes a session impossible -- see claim 1 above.
      expect(row.email).toBe('muse@test-root.internal');
      expect(row.passwordHash).toBeNull();
    });

    it('is hidden from the member directory, like every non-person account', async () => {
      await createAccount('Muse');

      const res = await request(server)
        .get('/api/v1/users/members')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .expect(200);

      const emails = JSON.stringify(res.body);
      expect(emails).not.toContain('muse@test-root.internal');
    });

    it('addresses each community account at its own slug', async () => {
      const mine = await createAccount('Muse');
      const theirs = await createAccount('Muse', otherDomain, otherAdminCookie);

      // Until v2-29 both were `muse@integration.invalid`: one address naming
      // the platform, identical in every community. That is what made a
      // correctly-scoped row read as another community's account on stage.
      expect(mine.email).toBe('muse@test-root.internal');
      expect(theirs.email).toBe('muse@other-muse.internal');
      expect(mine.id).not.toBe(theirs.id);
    });

    it('refuses a second account at the same address in one community', async () => {
      await createAccount('Muse');

      await request(server)
        .post('/api/v1/admin/integrations')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .send({ name: 'Muse' })
        .expect(400);
    });
  });

  describe('the token', () => {
    it('is returned once and stored only as a hash', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);

      expect(token.startsWith('cet_')).toBe(true);

      const row = await inTenant(TEST_TENANT_ID, () =>
        prisma.api_tokens.findFirstOrThrow({ where: { userId: account.id } }),
      );

      // The plaintext appears nowhere in the row, and the stored value is its
      // SHA-256 -- so a database dump cannot be replayed against the API.
      expect(JSON.stringify(row)).not.toContain(token);
      expect(row.tokenHash).toBe(hashToken(token));
      expect(row.tokenPrefix).toBe(token.slice(0, 12));
    });

    it('is never readable back through the listing', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);

      const res = await request(server)
        .get('/api/v1/admin/integrations')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(JSON.stringify(res.body)).not.toContain(token);

      // Found by address, not by index: the listing deliberately includes the
      // deployment's own automation account, which carries the same
      // `is_service_account` column and was seeded first. Indexing position 0
      // asserted the wrong account, which is how this test first failed.
      const muse = res.body.find(
        (a: { email: string }) => a.email === 'muse@test-root.internal',
      );
      expect(muse.tokens).toHaveLength(1);
      expect(muse.tokens[0].prefix).toBe(token.slice(0, 12));
      expect(muse.tokens[0].live).toBe(true);

      // And the automation account is listed beside it, with no tokens.
      const automation = res.body.find(
        (a: { role: string }) => a.role === UserRole.AUTOMATION,
      );
      expect(automation.tokens).toHaveLength(0);
    });

    it('opens GET /muse/me and reports the right community', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);

      const res = await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // v1's contract shape, kept identical -- Muse already reads these keys.
      expect(res.body.userId).toBe(account.id);
      expect(res.body.name).toBe('Muse');
      expect(typeof res.body.tokenExpiresAt).toBe('string');
      // Additive: v1 is single-tenant and could not answer this.
      expect(res.body.community.id).toBe(TEST_TENANT_ID);
    });

    it('stamps last_used_at, so "has Muse ever called us" is answerable', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);

      const before = await inTenant(TEST_TENANT_ID, () =>
        prisma.api_tokens.findFirstOrThrow({ where: { userId: account.id } }),
      );
      expect(before.lastUsedAt).toBeNull();

      await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // The stamp is fire-and-forget, so give the floating write a turn.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const after = await inTenant(TEST_TENANT_ID, () =>
        prisma.api_tokens.findFirstOrThrow({ where: { userId: account.id } }),
      );
      expect(after.lastUsedAt).not.toBeNull();
    });
  });

  describe('what a token does NOT open', () => {
    /**
     * Claim 1. `OperatorGuard` admits `is_service_account === true` on the root
     * tenant, and a Muse account now carries that column -- so this is the test
     * standing between that guard and a Muse token reaching the operator's
     * cross-community surface.
     */
    it('cannot reach an operator route', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);

      await request(server)
        .get('/api/v1/system/email/inbound')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('cannot reach an admin route in its own community', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);

      await request(server)
        .get('/api/v1/admin/integrations')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('cannot be exchanged for a session', async () => {
      const account = await createAccount('Muse');
      await issueToken(account.id);

      // No password hash, so the ordinary login refuses outright -- which is
      // what makes every session-guarded route unreachable for this account.
      await request(server)
        .post('/api/v1/auth/login')
        .set('Host', TEST_TENANT_DOMAIN)
        .send({ email: 'muse@test-root.internal', password: 'anything' })
        .expect(401);
    });

    it('is refused on /muse when presented as a cookie instead of a bearer', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);

      await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', `access_token=${token}`)
        .expect(401);
    });

    it('refuses an admin session on a /muse route', async () => {
      await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .expect(401);
    });

    it('refuses the operator too -- a cookie opens no /muse route', async () => {
      await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', operatorCookie)
        .expect(401);
    });
  });

  describe('the token names the community, not the host', () => {
    /**
     * Claim 2. Presented on another community's host, the token still serves
     * its own community -- and crucially reaches none of the host's rows.
     */
    it('serves its own community when presented on another host', async () => {
      const mine = await createAccount('Muse');
      const token = await issueToken(mine.id);

      const res = await request(server)
        .get('/api/v1/muse/me')
        .set('Host', otherDomain)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // The host says `otherTenantId`; the token wins.
      expect(res.body.community.id).toBe(TEST_TENANT_ID);
      expect(res.body.community.id).not.toBe(otherTenantId);
      expect(res.body.userId).toBe(mine.id);
    });

    it('does not let one community reach another, in either direction', async () => {
      const mine = await createAccount('Muse');
      const theirs = await createAccount('Muse', otherDomain, otherAdminCookie);

      const myToken = await issueToken(mine.id);
      const theirToken = await issueToken(theirs.id, otherDomain, otherAdminCookie);

      const minePresented = await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${myToken}`)
        .expect(200);

      const theirsPresented = await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${theirToken}`)
        .expect(200);

      // Both tokens on one host, each resolving to its own community. Neither
      // side is empty, which is what makes this conclusive rather than
      // suggestive.
      expect(minePresented.body.community.id).toBe(TEST_TENANT_ID);
      expect(theirsPresented.body.community.id).toBe(otherTenantId);
      expect(minePresented.body.userId).not.toBe(theirsPresented.body.userId);
    });

    it("refuses an admin issuing a token for another community's account", async () => {
      const theirs = await createAccount('Muse', otherDomain, otherAdminCookie);

      // Scoped lookup, so the account simply does not exist from here.
      await request(server)
        .post(`/api/v1/admin/integrations/${theirs.id}/tokens`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .send()
        .expect(404);
    });
  });

  describe('revocation, expiry and the off switch', () => {
    it('refuses a revoked token', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);

      const tokenRow = await inTenant(TEST_TENANT_ID, () =>
        prisma.api_tokens.findFirstOrThrow({ where: { userId: account.id } }),
      );

      await request(server)
        .delete(`/api/v1/admin/integrations/tokens/${tokenRow.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .expect(204);

      await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('refuses an expired token', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);

      await inTenant(TEST_TENANT_ID, async () => {
        await prisma.api_tokens.updateMany({
          where: { userId: account.id },
          data: { expiresAt: new Date(Date.now() - 1000) },
        });
      });

      await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('issues with a 60-day expiry', async () => {
      const account = await createAccount('Muse');
      await issueToken(account.id);

      const row = await inTenant(TEST_TENANT_ID, () =>
        prisma.api_tokens.findFirstOrThrow({ where: { userId: account.id } }),
      );

      const days = (row.expiresAt.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(59);
      expect(days).toBeLessThan(61);
    });

    /**
     * Claim 3, and v1's deliberate behaviour: the role is the off switch,
     * because `MuseTokenGuard` requires it as currently held.
     */
    it('disables the token while the account is flipped to automation', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);

      await inTenant(TEST_TENANT_ID, async () => {
        await prisma.users.updateMany({
          where: { id: account.id },
          data: { role: UserRole.AUTOMATION },
        });
      });

      await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      // And works again once flipped back -- the same token, not a reissued one.
      await inTenant(TEST_TENANT_ID, async () => {
        await prisma.users.updateMany({
          where: { id: account.id },
          data: { role: UserRole.MUSE },
        });
      });

      await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('refuses a suspended account', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);

      await inTenant(TEST_TENANT_ID, async () => {
        await prisma.users.updateMany({
          where: { id: account.id },
          data: { status: UserStatus.SUSPENDED },
        });
      });

      await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('kills the previous token on rotation, immediately', async () => {
      const account = await createAccount('Muse');
      const first = await issueToken(account.id);

      const res = await request(server)
        .post('/api/v1/muse/token/rotate')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${first}`)
        // 200, not Nest's POST default of 201: the contract documents 200 and
        // a status code is part of what an outside app already handles.
        .expect(200);

      const second = res.body.token;
      expect(second).not.toBe(first);

      // The credential that made the rotation call is already dead.
      await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${first}`)
        .expect(401);

      await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${second}`)
        .expect(200);
    });

    it('issuing again revokes the earlier token, so only one is ever live', async () => {
      const account = await createAccount('Muse');
      const first = await issueToken(account.id);
      const second = await issueToken(account.id);

      const live = await inTenant(TEST_TENANT_ID, () =>
        prisma.api_tokens.count({ where: { userId: account.id, revokedAt: null } }),
      );
      expect(live).toBe(1);

      await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${first}`)
        .expect(401);

      await request(server)
        .get('/api/v1/muse/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${second}`)
        .expect(200);
    });

    it('refuses a malformed or unknown bearer value', async () => {
      for (const value of ['', 'nonsense', 'cet_notarealtoken', 'Bearer']) {
        await request(server)
          .get('/api/v1/muse/me')
          .set('Host', TEST_TENANT_DOMAIN)
          .set('Authorization', `Bearer ${value}`)
          .expect(401);
      }
    });
  });

  describe('who may hold an integration role', () => {
    it('refuses to give a human the muse role', async () => {
      const member = await seedUser(prisma, city.id, { email: 'human@example.test' });

      await request(server)
        .post(`/api/v1/admin/users/${member.id}/role`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .send({ role: UserRole.MUSE })
        .expect(403);
    });

    it('refuses to give a human the automation role', async () => {
      const member = await seedUser(prisma, city.id, { email: 'human2@example.test' });

      await request(server)
        .post(`/api/v1/admin/users/${member.id}/role`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .send({ role: UserRole.AUTOMATION })
        .expect(403);
    });

    it('allows an integration account to be flipped between roles and to admin', async () => {
      const account = await createAccount('Muse');

      for (const role of [UserRole.AUTOMATION, UserRole.ADMIN, UserRole.MUSE]) {
        await request(server)
          .post(`/api/v1/admin/users/${account.id}/role`)
          .set('Host', TEST_TENANT_DOMAIN)
          .set('Cookie', adminCookie)
          .send({ role })
          .expect(200);
      }
    });

    it('refuses to issue a token for an ordinary member', async () => {
      const member = await seedUser(prisma, city.id, { email: 'human3@example.test' });

      await request(server)
        .post(`/api/v1/admin/integrations/${member.id}/tokens`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .send()
        .expect(400);
    });
  });

  /**
   * The cover photo (found on stage, 2026-10-24).
   *
   * Muse sets a Facebook event's cover from `location.photos[0]`, and neither
   * event endpoint returned `photos` at all: the list used a narrow `select`
   * and the detail read used `include: { location: true }`, which pulls scalars
   * only. v1 loads `location.photos` on both, ordered by id, so this was a
   * divergence from a contract the item is meant to match exactly.
   *
   * Neither endpoint had a test. That is the reason it shipped, so the fix
   * comes with both the happy path and the private-venue case -- the detail
   * read was also skipping the address redaction v1 applies for `muse`.
   */
  describe('event cover photos', () => {
    const seedEventAt = async (locationId: number, isPrivate: boolean) =>
      inTenant(TEST_TENANT_ID, async () => {
        const location = await prisma.locations.update({
          where: { id: locationId },
          data: { isPrivate },
        });
        const admin = await prisma.users.findFirstOrThrow({
          where: { role: UserRole.ADMIN },
        });
        return prisma.events.create({
          data: {
            cityId: city.id,
            locationId: location.id,
            locationName: location.name,
            locationAddress: location.address,
            createdById: admin.id,
            title: 'Cover Photo Dinner',
            status: 'published',
            eventDate: toDateColumn('2099-01-01'),
            eventTime: toTimeColumn('18:30'),
          },
        });
      });

    const seedLocationWithPhotos = async () =>
      inTenant(TEST_TENANT_ID, async () => {
        const location = await seedLocation(prisma, city.id, { name: 'Cover Photo Cafe' });
        const admin = await prisma.users.findFirstOrThrow({
          where: { role: UserRole.ADMIN },
        });
        // Two photos, created newest-id-last, so ordering is observable.
        for (const name of ['first.jpg', 'second.jpg']) {
          await prisma.location_photos.create({
            data: {
              locationId: location.id,
              filePath: `/api/uploads/locations/${name}`,
              fileName: name,
              mimeType: 'image/jpeg',
              uploadedBy: admin.id,
            },
          });
        }
        return location;
      });

    it('serves the location photos on both event endpoints, cover first', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);
      const location = await seedLocationWithPhotos();
      const event = await seedEventAt(location.id, false);

      const list = await request(server)
        .get('/api/v1/muse/events')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const listed = list.body.find((e: { id: number }) => e.id === event.id);
      expect(listed.location.photos.map((p: { fileName: string }) => p.fileName)).toEqual([
        'first.jpg',
        'second.jpg',
      ]);

      const detail = await request(server)
        .get(`/api/v1/muse/events/${event.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // photos[0] is the cover, and it is the same one on both calls -- an
      // unordered join would let the same dinner change cover between them.
      expect(detail.body.location.photos[0].fileName).toBe('first.jpg');
      expect(detail.body.location.photos[0].filePath).toBe(
        '/api/uploads/locations/first.jpg',
      );
    });

    it('withholds a private venue photos and address, on both', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);
      const location = await seedLocationWithPhotos();
      const event = await seedEventAt(location.id, true);

      for (const url of ['/api/v1/muse/events', `/api/v1/muse/events/${event.id}`]) {
        const res = await request(server)
          .get(url)
          .set('Host', TEST_TENANT_DOMAIN)
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        const body = Array.isArray(res.body)
          ? res.body.find((e: { id: number }) => e.id === event.id)
          : res.body;

        // A picture of somebody's house gives away what the address withholds,
        // and Muse would publish it as a Facebook cover.
        expect(body.location.photos).toEqual([]);
        expect(body.location.address).toBeNull();
        expect(body.locationAddress).toBeNull();
      }
    });

    it('serves a private venue once the community opts in', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);
      const location = await seedLocationWithPhotos();
      const event = await seedEventAt(location.id, true);

      // Opt in through the admin API, not by writing the row -- the point of
      // the test is that the screen's switch reaches the Muse read.
      await request(server)
        .patch('/api/v1/admin/integrations/muse-settings')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .send({ sharePrivateVenues: true })
        .expect(200);

      const res = await request(server)
        .get(`/api/v1/muse/events/${event.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.location.photos).toHaveLength(2);
      expect(res.body.location.address).not.toBeNull();
    });

    it('does not let one community opt in on another behalf', async () => {
      // The setting is an app_config row and app_config is tenant-scoped, so
      // this should hold by construction -- which is exactly the kind of claim
      // worth a test, since a global row would look identical until the day a
      // second community turned it on.
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);
      const location = await seedLocationWithPhotos();
      const event = await seedEventAt(location.id, true);

      await request(server)
        .patch('/api/v1/admin/integrations/muse-settings')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .send({ sharePrivateVenues: true })
        .expect(200);

      const res = await request(server)
        .get(`/api/v1/muse/events/${event.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.location.photos).toEqual([]);
      expect(res.body.location.address).toBeNull();
    });
  });

  /**
   * Reported from stage 2026-10-24: one community's Automation Accounts screen
   * appeared to be showing another's Muse account.
   *
   * Both sides are seeded deliberately. A check where the other community has
   * no account of its own looks identical to a passing one -- the trap v2-34
   * recorded -- and here it would be worse than useless, because the two
   * communities' accounts share an email by design (unique per tenant since
   * v2-6), so an isolation failure and a correct result look the same unless
   * the ids are compared.
   */
  describe('one community cannot see another integration accounts', () => {
    it('lists only its own when both are named Muse', async () => {
      const mine = await createAccount('Muse');
      const theirs = await createAccount('Muse', otherDomain, otherAdminCookie);

      // Different addresses since v2-29, and different rows regardless --
      // the id is what proves isolation, since a shared address would make a
      // leak and a correct result look identical.
      expect(mine.email).not.toBe(theirs.email);
      expect(mine.id).not.toBe(theirs.id);

      const here = await request(server)
        .get('/api/v1/admin/integrations')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .expect(200);

      const there = await request(server)
        .get('/api/v1/admin/integrations')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      const ids = (body: { id: number }[]) => body.map((a) => a.id);

      expect(ids(here.body)).toContain(mine.id);
      expect(ids(here.body)).not.toContain(theirs.id);
      expect(ids(there.body)).toContain(theirs.id);
      expect(ids(there.body)).not.toContain(mine.id);
    });

    it('does not show another community tokens', async () => {
      const mine = await createAccount('Muse');
      const theirs = await createAccount('Muse', otherDomain, otherAdminCookie);
      await issueToken(mine.id);
      await issueToken(theirs.id, otherDomain, otherAdminCookie);

      const there = await request(server)
        .get('/api/v1/admin/integrations')
        .set('Host', otherDomain)
        .set('Cookie', otherAdminCookie)
        .expect(200);

      const prefixes = there.body.flatMap(
        (a: { tokens: { prefix: string }[] }) => a.tokens.map((t) => t.prefix),
      );
      expect(prefixes).toHaveLength(1);
    });
  });

  /**
   * Setting which automation an account acts as, from the screen that owns it
   * (Rob, 2026-10-24). The role is the integration's on/off switch rather than
   * a label -- `verify` requires `muse` as currently held -- so this endpoint
   * is what disables an integration without going to find the account in the
   * member admin.
   */
  describe('choosing which automation an account acts as', () => {
    const setRole = (userId: number, role: string, expected = 200) =>
      request(server)
        .patch(`/api/v1/admin/integrations/${userId}/role`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .send({ role })
        .expect(expected);

    it('turns the token off and on again', async () => {
      const account = await createAccount('Muse');
      const token = await issueToken(account.id);

      const callMuse = (expected: number) =>
        request(server)
          .get('/api/v1/muse/me')
          .set('Host', TEST_TENANT_DOMAIN)
          .set('Authorization', `Bearer ${token}`)
          .expect(expected);

      await callMuse(200);

      // The same token, unrevoked and unexpired -- only the role moved.
      await setRole(account.id, UserRole.AUTOMATION);
      await callMuse(401);

      await setRole(account.id, UserRole.MUSE);
      await callMuse(200);
    });

    it('refuses any role but the two integration ones', async () => {
      const account = await createAccount('Muse');

      // The escalation this endpoint exists to make unexpressible.
      for (const role of [UserRole.ADMIN, UserRole.SYSTEM_ADMIN, UserRole.MEMBER]) {
        await setRole(account.id, role, 400);
      }

      const row = await inTenant(TEST_TENANT_ID, () =>
        prisma.users.findUniqueOrThrow({ where: { id: account.id } }),
      );
      expect(row.role).toBe(UserRole.MUSE);
    });

    it('refuses a human, however the id is obtained', async () => {
      const human = await seedUser(prisma, city.id, { email: 'person@example.test' });

      await setRole(human.id, UserRole.MUSE, 400);

      const row = await inTenant(TEST_TENANT_ID, () =>
        prisma.users.findUniqueOrThrow({ where: { id: human.id } }),
      );
      expect(row.role).toBe(UserRole.MEMBER);
    });

    it('cannot reach another community account', async () => {
      const theirs = await createAccount('Muse', otherDomain, otherAdminCookie);

      await setRole(theirs.id, UserRole.AUTOMATION, 404);

      const row = await unscoped('reading the other community account', () =>
        prisma.users.findUniqueOrThrow({ where: { id: theirs.id } }),
      );
      expect(row.role).toBe(UserRole.MUSE);
    });
  });
});
