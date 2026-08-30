import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import { OAuthProvider, UserRole } from '../src/database/enums';
import { createTestApp, truncateAllTables, TEST_TENANT_DOMAIN } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { OAuthHandoffService } from '../src/modules/auth/oauth/oauth-handoff.service';
import { encodeOAuthState } from '../src/modules/auth/oauth/oauth-state.util';
import { TEST_TENANT_ID } from './setup-env';
import type { users as User } from '@prisma/client';

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

const unscoped = <T>(reason: string, fn: () => Promise<T>): Promise<T> =>
  runUnscoped(reason, async () => await fn());

/**
 * v2-8's Definition of Done, asserted end to end (REQ-TENANT-01.9 and 01.8).
 *
 * Two communities on one deployment, one with its own Google app and one with
 * nothing: a tenant with no credentials offers email/password only, a tenant
 * with credentials offers its own app, the same address holds a different set
 * of linked providers in each, and no secret comes back out over HTTP.
 *
 * The interesting cases are all cross-community. A single-tenant version of
 * this suite would pass with every credential lookup hardcoded to the first row
 * in the table.
 */
describe('Per-tenant OAuth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: TenantResolutionService;

  const TENANT_B_ID = 2;
  const TENANT_B_DOMAIN = 'second-community.test';

  const GOOGLE_A = { clientId: 'tenant-a-client-id', clientSecret: 'tenant-a-secret' };

  let adminA: User;
  let adminB: User;
  let handoff: OAuthHandoffService;
  let cookieA: string;
  let cookieB: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenants = app.get(TenantResolutionService);
    handoff = app.get(OAuthHandoffService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    tenants.clearCache();

    await prisma.tenants.create({
      data: { id: TENANT_B_ID, slug: 'second', domain: TENANT_B_DOMAIN },
    });

    const city = await seedCity(prisma);
    adminA = await inTenant(TEST_TENANT_ID, () =>
      seedUser(prisma, city.id, { role: UserRole.ADMIN }),
    );
    adminB = await inTenant(TENANT_B_ID, () =>
      seedUser(prisma, city.id, { role: UserRole.ADMIN }),
    );

    // Inside each member's own tenant, not outside it: `issueTokens` updates the
    // row it just read, and that update is scoped -- so logging B's admin in
    // from the ambient (A) context fails with P2025 rather than returning the
    // wrong session. The tenant-isolation suite documents the same trap.
    cookieA = await inTenant(TEST_TENANT_ID, () => loginAs(app, adminA));
    cookieB = await inTenant(TENANT_B_ID, () => loginAs(app, adminB));
  });

  /** Gives tenant A its own Google app, the way the admin screen would. */
  async function configureGoogleOnA(): Promise<void> {
    await request(app.getHttpServer())
      .put('/api/v1/admin/oauth/google')
      .set('Host', TEST_TENANT_DOMAIN)
      .set('Cookie', cookieA)
      .send(GOOGLE_A)
      .expect(200);
    tenants.clearCache();
  }

  describe('what a community offers', () => {
    it('offers neither provider where no app is registered', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/config/branding')
        .set('Host', TEST_TENANT_DOMAIN)
        .expect(200);

      expect(res.body.authProviders).toEqual({ google: false, facebook: false });
      expect(res.body.facebookAppId).toBeNull();
    });

    it('offers Google only to the community that registered it', async () => {
      await configureGoogleOnA();

      const a = await request(app.getHttpServer())
        .get('/api/v1/config/branding')
        .set('Host', TEST_TENANT_DOMAIN)
        .expect(200);
      const b = await request(app.getHttpServer())
        .get('/api/v1/config/branding')
        .set('Host', TENANT_B_DOMAIN)
        .expect(200);

      expect(a.body.authProviders).toEqual({ google: true, facebook: false });
      expect(b.body.authProviders).toEqual({ google: false, facebook: false });
    });
  });

  describe('starting a sign-in', () => {
    it("sends the member to the community's own Google app", async () => {
      await configureGoogleOnA();

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/google')
        .set('Host', TEST_TENANT_DOMAIN)
        .expect(302);

      const location = new URL(res.headers.location);
      expect(location.host).toBe('accounts.google.com');
      expect(location.searchParams.get('client_id')).toBe(GOOGLE_A.clientId);
      // Signed, and carrying the community the flow started on.
      expect(location.searchParams.get('state')).toMatch(/^[\w-]+\.[\w-]+$/);
    });

    // The button is not shown, but the route is reachable directly -- and a
    // community that switched Google off must not be signed into through
    // somebody else's app.
    it('refuses to start on a community with no app of its own', async () => {
      await configureGoogleOnA();

      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/google')
        .set('Host', TENANT_B_DOMAIN)
        .expect(302);

      expect(res.headers.location).toContain('/auth/error');
      expect(res.headers.location).toContain('reason=provider_not_offered');
    });
  });

  describe('the callback', () => {
    it('refuses a state that did not come from us', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/google/callback?code=abc&state=forged.signature')
        .set('Host', TEST_TENANT_DOMAIN)
        .expect(302);

      expect(res.headers.location).toContain('reason=invalid_state');
    });

    it('reports a cancelled consent as cancelled, not as a failure', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/google/callback?error=access_denied')
        .set('Host', TEST_TENANT_DOMAIN)
        .expect(302);

      expect(res.headers.location).toContain('reason=consent_denied');
    });

    // Found on stage: cancelling on one community showed the *root* community's
    // error page. Google returns `state` alongside `error=access_denied`, so the
    // originating community was knowable -- the error was just being checked
    // before the state was decoded, throwing that away.
    //
    // The request deliberately arrives on tenant A's host, because that is what
    // really happens: every callback lands on the one registered host regardless
    // of where the member started.
    it('sends a cancelled sign-in back to the community it started on', async () => {
      const state = encodeOAuthState(
        { tenantId: TENANT_B_ID },
        process.env.JWT_SECRET as string,
      );

      const res = await request(app.getHttpServer())
        .get(`/api/v1/auth/google/callback?error=access_denied&state=${state}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .expect(302);

      expect(res.headers.location).toContain(TENANT_B_DOMAIN);
      expect(res.headers.location).toContain('reason=consent_denied');
    });
  });

  describe('the handoff', () => {
    it('is refused on a community other than the one it was minted for', async () => {
      // Minted inside tenant A, as the callback does.
      const token = await inTenant(TEST_TENANT_ID, () => handoff.issue(adminA.id));

      // `oauth_handoffs` is scoped, so B's host simply cannot see the row.
      await request(app.getHttpServer())
        .post('/api/v1/auth/handoff')
        .set('Host', TENANT_B_DOMAIN)
        .send({ token })
        .expect(401);

      // Still redeemable where it belongs, so the refusal above was the scope
      // and not a spent ticket.
      const ok = await request(app.getHttpServer())
        .post('/api/v1/auth/handoff')
        .set('Host', TEST_TENANT_DOMAIN)
        .send({ token })
        .expect(201);

      expect((ok.headers['set-cookie'] as unknown as string[]).join()).toContain('access_token=');
    });

    it('cannot be redeemed twice', async () => {
      const token = await inTenant(TEST_TENANT_ID, () => handoff.issue(adminA.id));

      await request(app.getHttpServer())
        .post('/api/v1/auth/handoff')
        .set('Host', TEST_TENANT_DOMAIN)
        .send({ token })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/handoff')
        .set('Host', TEST_TENANT_DOMAIN)
        .send({ token })
        .expect(401);
    });

    // Host-only cookies mean the session belongs to the community that set it,
    // which is the whole reason the handoff exists.
    it('sets a cookie with no Domain attribute', async () => {
      const token = await inTenant(TEST_TENANT_ID, () => handoff.issue(adminA.id));

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/handoff')
        .set('Host', TEST_TENANT_DOMAIN)
        .send({ token })
        .expect(201);

      const cookies = res.headers['set-cookie'] as unknown as string[];
      const cookie = cookies.find((c) => c.startsWith('access_token='));
      expect(cookie).toBeDefined();
      expect(cookie!.toLowerCase()).not.toContain('domain=');
    });
  });

  describe('the admin endpoint', () => {
    it('never returns a stored secret', async () => {
      await configureGoogleOnA();

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/oauth')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', cookieA)
        .expect(200);

      expect(res.body.google).toEqual({
        clientId: GOOGLE_A.clientId,
        secretSet: true,
        enabled: true,
      });
      expect(JSON.stringify(res.body)).not.toContain(GOOGLE_A.clientSecret);
    });

    // The bug v2-9 was created to fix, one table over: @Roles(ADMIN) over a
    // row that is not this community's.
    it("leaves another community's credentials alone", async () => {
      await configureGoogleOnA();

      const b = await request(app.getHttpServer())
        .get('/api/v1/admin/oauth')
        .set('Host', TENANT_B_DOMAIN)
        .set('Cookie', cookieB)
        .expect(200);

      expect(b.body.google.enabled).toBe(false);

      await request(app.getHttpServer())
        .put('/api/v1/admin/oauth/google')
        .set('Host', TENANT_B_DOMAIN)
        .set('Cookie', cookieB)
        .send({ clientId: 'b-id', clientSecret: 'b-secret' })
        .expect(200);

      const a = await request(app.getHttpServer())
        .get('/api/v1/admin/oauth')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', cookieA)
        .expect(200);

      expect(a.body.google.clientId).toBe(GOOGLE_A.clientId);
    });

    it('switches a provider off when the id is omitted', async () => {
      await configureGoogleOnA();

      const res = await request(app.getHttpServer())
        .put('/api/v1/admin/oauth/google')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', cookieA)
        .send({})
        .expect(200);

      expect(res.body.google).toEqual({ clientId: null, secretSet: false, enabled: false });
    });

    // Both halves or neither, enforced by the DTO. There is deliberately no
    // "keep the stored secret" path: the secret cannot be read back, so a blank
    // box is ambiguous between keeping one and forgetting one, and the failure
    // that produces lands at the token exchange after consent. Stage found the
    // UI claiming otherwise -- the API had always refused it.
    it('refuses a client id with no secret beside it, and changes nothing', async () => {
      await configureGoogleOnA();

      await request(app.getHttpServer())
        .put('/api/v1/admin/oauth/google')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', cookieA)
        .send({ clientId: 'rotated-client-id' })
        .expect(400);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/oauth')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', cookieA)
        .expect(200);
      expect(res.body.google).toEqual({
        clientId: GOOGLE_A.clientId,
        secretSet: true,
        enabled: true,
      });
    });

    it('is closed to a member who is not an admin', async () => {
      const city = await unscoped('test fixture', () => prisma.cities.findFirstOrThrow());
      const member = await inTenant(TEST_TENANT_ID, () =>
        seedUser(prisma, city.id, { role: UserRole.MEMBER }),
      );
      const memberCookie = await inTenant(TEST_TENANT_ID, () => loginAs(app, member));

      await request(app.getHttpServer())
        .get('/api/v1/admin/oauth')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', memberCookie)
        .expect(403);
    });
  });

  describe('secrets at rest', () => {
    // The DoD's fourth clause. Read with raw SQL deliberately: Prisma routes
    // every ordinary read through the encryption extension, which would hand
    // back the plaintext and prove nothing about what is on disk.
    it('stores the client secret as ciphertext', async () => {
      await configureGoogleOnA();

      const rows = await unscoped('reading raw ciphertext', () =>
        prisma.$queryRaw<Array<{ google_client_secret: string | null }>>`
          SELECT google_client_secret FROM tenants WHERE id = ${TEST_TENANT_ID}
        `,
      );

      expect(rows[0].google_client_secret).toBeTruthy();
      expect(rows[0].google_client_secret).not.toBe(GOOGLE_A.clientSecret);
    });
  });

  describe('linked providers per community', () => {
    // REQ-TENANT-01.5 plus 01.9: one address is a different person in each
    // community, so it may legitimately have Google linked in one and only a
    // password in the other.
    it('lets one address hold different providers in two communities', async () => {
      const shared = 'shared@example.com';
      const city = await unscoped('test fixture', () => prisma.cities.findFirstOrThrow());

      const inA = await inTenant(TEST_TENANT_ID, () =>
        seedUser(prisma, city.id, { email: shared, role: UserRole.MEMBER }),
      );
      const inB = await inTenant(TENANT_B_ID, () =>
        seedUser(prisma, city.id, { email: shared, role: UserRole.MEMBER }),
      );
      expect(inA.id).not.toBe(inB.id);

      await inTenant(TEST_TENANT_ID, () =>
        prisma.oauth_accounts.create({
          data: { userId: inA.id, provider: OAuthProvider.GOOGLE, providerId: 'g-1', email: shared },
        }),
      );

      const linkedInA = await inTenant(TEST_TENANT_ID, () =>
        prisma.oauth_accounts.findMany({ where: { user: { email: shared } } }),
      );
      const linkedInB = await inTenant(TENANT_B_ID, () =>
        prisma.oauth_accounts.findMany({ where: { user: { email: shared } } }),
      );

      expect(linkedInA).toHaveLength(1);
      expect(linkedInB).toHaveLength(0);
    });
  });
});
