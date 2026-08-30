import { vi } from 'vitest';
import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import request from 'supertest';
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedUser, loginAs, hashPassword } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City, facebook_deletion_requests as FacebookDeletionRequest, invites as Invite, oauth_accounts as OAuthAccount, users as User } from '@prisma/client';
import { EmailStatus, FacebookDeletionStatus, InviteType, OAuthProvider, UserRole, UserStatus } from '../src/database/enums';
import { TEST_TENANT_ID } from './setup-env';

// Matches the base64url signed_request format AuthController.facebookDeletionCallback
// verifies: `${sigB64url}.${payloadB64url}`, HMAC-SHA256 computed over the raw
// base64url payload string (not the decoded JSON).
function buildSignedRequest(secret: string, payload: Record<string, unknown>): string {
  const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)));
  const sig = createHmac('sha256', secret).update(payloadB64).digest();
  return `${b64url(sig)}.${payloadB64}`;
}

/**
 * The Meta app the test community registers.
 *
 * A community offers Facebook only where it has its own app (REQ-TENANT-01.9),
 * so these specs have to give it one -- there is no deployment-wide app to fall
 * back to any more, and the env vars that used to hold one are gone. The secret
 * is the same value `setup-env.ts` used to put in FACEBOOK_APP_SECRET, so the
 * signed_request fixtures below are unchanged.
 */
const FB_APP_ID = 'test-facebook-app-id';
const FB_SECRET = 'test-facebook-app-secret-not-for-real-use';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
  const PASSWORD = 'CorrectHorse123!';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    resetThrottler(app);
    city = await seedCity(prisma);

    // Re-applied every test because truncateAllTables re-seeds the tenant row.
    await prisma.tenants.update({
      where: { id: TEST_TENANT_ID },
      data: { facebookAppId: FB_APP_ID, facebookAppSecret: FB_SECRET },
    });
  });

  async function seedMemberInvite(overrides: Partial<Invite> = {}): Promise<Invite> {
    const admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: `admin-${Date.now()}@example.test` });
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 48);
    return prisma.invites.create({ data: {
        token: `member-invite-${Date.now()}-${Math.random()}`,
        type: InviteType.MEMBER,
        createdBy: admin.id,
        boundToEmail: 'invitee@example.test',
        expiresAt,
        maxUses: 1,
        useCount: 0,
        ...overrides,
      }, });
  }

  describe('POST /auth/register', () => {
    it('registers a new member with a valid bound invite', async () => {
      const invite = await seedMemberInvite();

      const res = await request(server)
        .post('/api/v1/auth/register')
        .send({
          inviteToken: invite.token,
          fullName: 'New Member',
          email: invite.boundToEmail,
          password: PASSWORD,
        })
        .expect(201);
      expect(res.body.message).toContain('Registration successful');
      const created = await prisma.users.findFirst({ where: { email: invite.boundToEmail! } });
      expect(created).toBeTruthy();
      expect(created!.emailStatus).toBe(EmailStatus.PENDING);
      expect(created!.role).toBe(UserRole.MEMBER);
      expect(created!.invitedBy).toBe(invite.createdBy);

      const updatedInvite = await prisma.invites.findFirst({ where: { id: invite.id } });
      expect(updatedInvite!.useCount).toBe(1);
      expect(updatedInvite!.redeemedAt).toBeTruthy();
    });

    it('rejects a payload missing required fields', async () => {
      const res = await request(server).post('/api/v1/auth/register').send({ email: 'a@example.test' }).expect(400);
      expect(res.body.message).toEqual(expect.any(Array));
    });

    it('rejects registration when the email already belongs to an active member', async () => {
      const invite = await seedMemberInvite({ boundToEmail: 'taken@example.test' });
      await seedUser(prisma, city.id, { email: 'taken@example.test', role: UserRole.MEMBER });

      await request(server)
        .post('/api/v1/auth/register')
        .send({ inviteToken: invite.token, fullName: 'Someone', email: 'taken@example.test', password: PASSWORD })
        .expect(409);
    });

    it('rejects an unknown invite token', async () => {
      const res = await request(server)
        .post('/api/v1/auth/register')
        .send({ inviteToken: 'not-a-real-token', fullName: 'Someone', email: 'someone@example.test', password: PASSWORD })
        .expect(400);
      expect(res.body.reason).toBe('invalid_invite');
    });

    it('rejects an expired invite', async () => {
      const expired = new Date();
      expired.setDate(expired.getDate() - 1);
      const invite = await seedMemberInvite({ expiresAt: expired });

      const res = await request(server)
        .post('/api/v1/auth/register')
        .send({ inviteToken: invite.token, fullName: 'Someone', email: invite.boundToEmail, password: PASSWORD })
        .expect(400);
      expect(res.body.reason).toBe('invite_expired');
    });

    it('rejects a revoked invite', async () => {
      const invite = await seedMemberInvite({ isRevoked: true });

      const res = await request(server)
        .post('/api/v1/auth/register')
        .send({ inviteToken: invite.token, fullName: 'Someone', email: invite.boundToEmail, password: PASSWORD })
        .expect(400);
      expect(res.body.reason).toBe('invite_used');
    });

    it('rejects an already-used single-use invite', async () => {
      const invite = await seedMemberInvite({ useCount: 1, maxUses: 1 });

      const res = await request(server)
        .post('/api/v1/auth/register')
        .send({ inviteToken: invite.token, fullName: 'Someone', email: invite.boundToEmail, password: PASSWORD })
        .expect(400);
      expect(res.body.reason).toBe('invite_used');
    });

    it('rejects a bound invite used with a different email', async () => {
      const invite = await seedMemberInvite({ boundToEmail: 'bound@example.test' });

      const res = await request(server)
        .post('/api/v1/auth/register')
        .send({ inviteToken: invite.token, fullName: 'Someone', email: 'different@example.test', password: PASSWORD })
        .expect(400);
      expect(res.body.reason).toBe('invite_email_mismatch');
    });
  });

  describe('POST /auth/login', () => {
    async function seedActiveMember(email: string, password = PASSWORD): Promise<User> {
      return seedUser(prisma, city.id, {
        email,
        role: UserRole.MEMBER,
        status: UserStatus.ACTIVE,
        emailStatus: EmailStatus.ACTIVE,
        passwordHash: await hashPassword(password),
      });
    }

    it('logs in with correct credentials and sets the access_token cookie', async () => {
      await seedActiveMember('login-ok@example.test');

      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'login-ok@example.test', password: PASSWORD })
        .expect(200);

      expect(res.body.message).toBe('ok');
      expect((res.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('access_token='))).toBe(true);
    });

    it('rejects an unknown email', async () => {
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.test', password: PASSWORD })
        .expect(401);
    });

    it('rejects an incorrect password', async () => {
      await seedActiveMember('login-bad@example.test');

      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'login-bad@example.test', password: 'wrong-password' })
        .expect(401);
    });

    it('rejects login for a suspended user', async () => {
      await seedActiveMember('login-suspended@example.test');
      await prisma.users.updateMany({ where: { email: 'login-suspended@example.test' }, data: { status: UserStatus.SUSPENDED } });

      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'login-suspended@example.test', password: PASSWORD })
        .expect(401);
    });

    it('rejects login while email verification is pending', async () => {
      await seedActiveMember('login-pending@example.test');
      await prisma.users.updateMany({ where: { email: 'login-pending@example.test' }, data: { emailStatus: EmailStatus.PENDING } });

      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'login-pending@example.test', password: PASSWORD })
        .expect(401);
    });

    it('locks the account after repeated failed attempts', async () => {
      await seedActiveMember('login-lockout@example.test');

      for (let i = 0; i < 4; i += 1) {
        await request(server)
          .post('/api/v1/auth/login')
          .send({ email: 'login-lockout@example.test', password: 'wrong-password' })
          .expect(401);
      }

      // 5th attempt (even with the correct password) is blocked by the lockout window
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'login-lockout@example.test', password: PASSWORD })
        .expect(401);
      expect(res.body.message).toBe('account_locked');

      const user = await prisma.users.findFirst({ where: { email: 'login-lockout@example.test' } });
      expect(user!.loginLockedUntil).toBeTruthy();
    });
  });

  describe('GET /auth/verify-email', () => {
    it('activates a pending account with a valid token', async () => {
      const user = await seedUser(prisma, city.id, {
        emailStatus: EmailStatus.PENDING,
        emailVerificationToken: 'valid-token',
        emailVerificationExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      await request(server).get('/api/v1/auth/verify-email').query({ token: 'valid-token' }).expect(200);

      const updated = await prisma.users.findFirst({ where: { id: user.id } });
      expect(updated!.emailStatus).toBe(EmailStatus.ACTIVE);
      expect(updated!.emailVerificationToken).toBeNull();
    });

    it('rejects a missing token', async () => {
      await request(server).get('/api/v1/auth/verify-email').expect(400);
    });

    it('rejects an unknown token', async () => {
      await request(server).get('/api/v1/auth/verify-email').query({ token: 'nonexistent' }).expect(400);
    });

    it('rejects an expired token', async () => {
      await seedUser(prisma, city.id, {
        emailStatus: EmailStatus.PENDING,
        emailVerificationToken: 'expired-token',
        emailVerificationExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      await request(server).get('/api/v1/auth/verify-email').query({ token: 'expired-token' }).expect(400);
    });
  });

  describe('POST /auth/resend-verification', () => {
    it('always returns 200 regardless of whether the email exists', async () => {
      await request(server).post('/api/v1/auth/resend-verification').send({ email: 'nobody@example.test' }).expect(200);
    });

    it('issues a fresh token for a pending account', async () => {
      const user = await seedUser(prisma, city.id, {
        emailStatus: EmailStatus.PENDING,
        passwordHash: await hashPassword(PASSWORD),
        emailVerificationToken: 'old-token',
      });

      await request(server).post('/api/v1/auth/resend-verification').send({ email: user.email }).expect(200);

      const updated = await prisma.users.findFirst({ where: { id: user.id } });
      expect(updated!.emailVerificationToken).not.toBe('old-token');
    });
  });

  describe('POST /auth/forgot-password + POST /auth/reset-password', () => {
    it('always returns 200 for forgot-password, even for an unknown email', async () => {
      await request(server).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.test' }).expect(200);
    });

    it('sets a reset token for an active member with a password', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: await hashPassword(PASSWORD) });

      await request(server).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);

      const updated = await prisma.users.findFirst({ where: { id: user.id } });
      expect(updated!.passwordResetToken).toBeTruthy();
    });

    it('resets the password with a valid token and allows login with the new password', async () => {
      const user = await seedUser(prisma, city.id, {
        passwordHash: await hashPassword(PASSWORD),
        emailStatus: EmailStatus.ACTIVE,
        passwordResetToken: 'reset-token',
        passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });

      await request(server)
        .post('/api/v1/auth/reset-password')
        .send({ token: 'reset-token', password: 'BrandNewPassword456!' })
        .expect(200);

      await request(server)
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: 'BrandNewPassword456!' })
        .expect(200);
    });

    it('rejects an unknown reset token', async () => {
      await request(server).post('/api/v1/auth/reset-password').send({ token: 'bogus', password: 'BrandNewPassword456!' }).expect(400);
    });

    it('rejects an expired reset token', async () => {
      await seedUser(prisma, city.id, {
        passwordHash: await hashPassword(PASSWORD),
        passwordResetToken: 'expired-reset',
        passwordResetExpiresAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      await request(server)
        .post('/api/v1/auth/reset-password')
        .send({ token: 'expired-reset', password: 'BrandNewPassword456!' })
        .expect(400);
    });
  });

  describe('POST /auth/set-password', () => {
    it('sets a password for an OAuth-only account with no email change', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: null, emailStatus: EmailStatus.ACTIVE });
      const cookie = await loginAs(app, user);

      const res = await request(server)
        .post('/api/v1/auth/set-password')
        .set('Cookie', cookie)
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      expect(res.body.needsVerification).toBe(false);

      await request(server).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
    });

    it('requires re-verification when changing the email at the same time', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: null });
      const cookie = await loginAs(app, user);

      const res = await request(server)
        .post('/api/v1/auth/set-password')
        .set('Cookie', cookie)
        .send({ email: 'brand-new-email@example.test', password: PASSWORD })
        .expect(200);
      expect(res.body.needsVerification).toBe(true);

      const updated = await prisma.users.findFirst({ where: { id: user.id } });
      expect(updated!.emailStatus).toBe(EmailStatus.PENDING);
    });

    it('rejects setting a password when one already exists', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: await hashPassword(PASSWORD) });
      const cookie = await loginAs(app, user);

      await request(server)
        .post('/api/v1/auth/set-password')
        .set('Cookie', cookie)
        .send({ email: user.email, password: 'AnotherPassword123!' })
        .expect(400);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).post('/api/v1/auth/set-password').send({ email: 'x@example.test', password: PASSWORD }).expect(401);
    });
  });

  describe('PATCH /auth/password', () => {
    it('changes the password given the correct current password', async () => {
      const user = await seedUser(prisma, city.id, {
        passwordHash: await hashPassword(PASSWORD),
        emailStatus: EmailStatus.ACTIVE,
      });
      const cookie = await loginAs(app, user);

      await request(server)
        .patch('/api/v1/auth/password')
        .set('Cookie', cookie)
        .send({ currentPassword: PASSWORD, newPassword: 'NewPassword789!' })
        .expect(200);

      await request(server).post('/api/v1/auth/login').send({ email: user.email, password: 'NewPassword789!' }).expect(200);
    });

    it('rejects an incorrect current password', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: await hashPassword(PASSWORD) });
      const cookie = await loginAs(app, user);

      await request(server)
        .patch('/api/v1/auth/password')
        .set('Cookie', cookie)
        .send({ currentPassword: 'wrong', newPassword: 'NewPassword789!' })
        .expect(401);
    });

    it('rejects changing password on an account with no password set', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: null });
      const cookie = await loginAs(app, user);

      await request(server)
        .patch('/api/v1/auth/password')
        .set('Cookie', cookie)
        .send({ currentPassword: 'whatever', newPassword: 'NewPassword789!' })
        .expect(400);
    });
  });

  describe('GET /auth/me + POST /auth/logout', () => {
    it('returns the current user without password fields', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: await hashPassword(PASSWORD) });
      const cookie = await loginAs(app, user);

      const res = await request(server).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
      expect(res.body.id).toBe(user.id);
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/auth/me').expect(401);
    });

    it('invalidates the session on logout', async () => {
      const user = await seedUser(prisma, city.id);
      const cookie = await loginAs(app, user);

      await request(server).post('/api/v1/auth/logout').set('Cookie', cookie).expect(201);
      await request(server).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    });
  });

  describe('GET /auth/providers + DELETE /auth/providers/:provider', () => {
    it('lists linked providers and password status', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: await hashPassword(PASSWORD) });
      await prisma.oauth_accounts.create({ data: {
        userId: user.id,
        provider: OAuthProvider.GOOGLE,
        providerId: 'google-123',
        email: user.email,
      } });
      const cookie = await loginAs(app, user);

      const res = await request(server).get('/api/v1/auth/providers').set('Cookie', cookie).expect(200);
      expect(res.body.google).toMatchObject({ email: user.email });
      expect(res.body.hasPassword).toBe(true);
      expect(res.body.hasMultipleMethods).toBe(true);
    });

    it('disconnects a provider when another auth method exists', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: await hashPassword(PASSWORD) });
      await prisma.oauth_accounts.create({ data: {
        userId: user.id,
        provider: OAuthProvider.GOOGLE,
        providerId: 'google-123',
        email: user.email,
      } });
      const cookie = await loginAs(app, user);

      await request(server).delete('/api/v1/auth/providers/google').set('Cookie', cookie).expect(204);

      const remaining = await prisma.oauth_accounts.findMany({ where: { userId: user.id } });
      expect(remaining).toHaveLength(0);
    });

    it('rejects disconnecting the only login method with a 409', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: null });
      await prisma.oauth_accounts.create({ data: {
        userId: user.id,
        provider: OAuthProvider.GOOGLE,
        providerId: 'google-only',
        email: user.email,
      } });
      const cookie = await loginAs(app, user);

      const res = await request(server).delete('/api/v1/auth/providers/google').set('Cookie', cookie).expect(409);
      expect(res.body.error).toBe('ONLY_AUTH_METHOD');
    });

    it('returns 404 when the provider is not linked', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: await hashPassword(PASSWORD) });
      const cookie = await loginAs(app, user);

      await request(server).delete('/api/v1/auth/providers/google').set('Cookie', cookie).expect(404);
    });

    it('rejects an invalid provider name', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: await hashPassword(PASSWORD) });
      const cookie = await loginAs(app, user);

      await request(server).delete('/api/v1/auth/providers/twitter').set('Cookie', cookie).expect(401);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).delete('/api/v1/auth/providers/google').expect(401);
    });
  });

  describe('POST /auth/facebook + POST /auth/facebook/link', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    // Two calls now, not one. `debug_token` ties the access token back to the
    // app that minted it -- without it, a token from any Facebook app at all
    // would resolve to a profile and sign that person in, which is a live
    // problem once apps are per community. See FacebookOAuthService.
    function mockFacebookGraphApi(fbUser: Record<string, unknown>): void {
      global.fetch = vi.fn().mockImplementation((url: unknown) => {
        if (String(url).includes('/debug_token')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: { app_id: FB_APP_ID, is_valid: true, user_id: fbUser.id },
            }),
          });
        }
        return Promise.resolve({ ok: true, json: async () => fbUser });
      }) as unknown as typeof fetch;
    }

    it('registers a new user via Facebook using a bound invite', async () => {
      const invite = await seedMemberInvite({ boundToEmail: 'fbuser@example.test' });
      mockFacebookGraphApi({ id: 'fb-1', name: 'FB User', email: 'fbuser@example.test' });

      const res = await request(server)
        .post('/api/v1/auth/facebook')
        .send({ accessToken: 'fake-fb-token', inviteToken: invite.token })
        .expect(201);
      expect(res.body.message).toBe('ok');
      expect((res.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('access_token='))).toBe(true);

      const user = await prisma.users.findFirst({ where: { email: 'fbuser@example.test' } });
      expect(user).toBeTruthy();
    });

    it('rejects an invalid Facebook access token', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

      await request(server).post('/api/v1/auth/facebook').send({ accessToken: 'bad-token' }).expect(401);
    });

    it('rejects Facebook login with no invite for a brand-new user', async () => {
      mockFacebookGraphApi({ id: 'fb-2', name: 'No Invite', email: 'noinvite@example.test' });

      await request(server).post('/api/v1/auth/facebook').send({ accessToken: 'fake-fb-token' }).expect(401);
    });

    it('links a Facebook account to the current user', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: await hashPassword(PASSWORD) });
      const cookie = await loginAs(app, user);
      mockFacebookGraphApi({ id: 'fb-link-1', name: user.fullName, email: user.email });

      await request(server)
        .post('/api/v1/auth/facebook/link')
        .set('Cookie', cookie)
        .send({ accessToken: 'fake-fb-token' })
        .expect(201);

      const linked = await prisma.oauth_accounts
        .findFirst({ where: { userId: user.id, provider: OAuthProvider.FACEBOOK } });
      expect(linked).toBeTruthy();
    });

    it('rejects linking a Facebook account already linked to someone else', async () => {
      const other = await seedUser(prisma, city.id, { email: 'other@example.test' });
      await prisma.oauth_accounts.create({ data: {
        userId: other.id,
        provider: OAuthProvider.FACEBOOK,
        providerId: 'fb-taken',
        email: other.email,
      } });

      const user = await seedUser(prisma, city.id, { passwordHash: await hashPassword(PASSWORD) });
      const cookie = await loginAs(app, user);
      mockFacebookGraphApi({ id: 'fb-taken', name: user.fullName, email: user.email });

      await request(server)
        .post('/api/v1/auth/facebook/link')
        .set('Cookie', cookie)
        .send({ accessToken: 'fake-fb-token' })
        .expect(409);
    });
  });

  describe('POST /auth/facebook/deletion-callback + GET /auth/facebook/deletion-status', () => {
    // Signed with the community's own app secret now, not the deployment's --
    // Meta posts this to the callback registered on the app that was deleted,
    // and that app belongs to one community.

    it('rejects a signed_request with an invalid signature', async () => {
      await request(server)
        .post('/api/v1/auth/facebook/deletion-callback')
        .send({ signed_request: buildSignedRequest('wrong-secret', { user_id: 'fb-del-1' }) })
        .expect(401);
    });

    it('removes only the Facebook oauth row when another OAuth provider is also linked', async () => {
      // handleFacebookDeletion's "other auth method" check only counts rows in
      // oauth_accounts — unlike disconnectProvider, it does not consider whether
      // the user also has a password set (see auth.service.ts handleFacebookDeletion).
      const user = await seedUser(prisma, city.id, { passwordHash: null });
      await prisma.oauth_accounts.create({ data: {
        userId: user.id,
        provider: OAuthProvider.GOOGLE,
        providerId: 'google-del-multi',
        email: user.email,
      } });
      await prisma.oauth_accounts.create({ data: {
        userId: user.id,
        provider: OAuthProvider.FACEBOOK,
        providerId: 'fb-del-multi',
        email: user.email,
      } });

      const res = await request(server)
        .post('/api/v1/auth/facebook/deletion-callback')
        .send({ signed_request: buildSignedRequest(FB_SECRET, { user_id: 'fb-del-multi' }) })
        .expect(200);
      expect(res.body.confirmation_code).toBeTruthy();

      const stillActive = await prisma.users.findFirst({ where: { id: user.id } });
      expect(stillActive!.status).toBe(UserStatus.ACTIVE);
      const oauthRows = await prisma.oauth_accounts.findMany({ where: { userId: user.id } });
      expect(oauthRows).toHaveLength(1);
      expect(oauthRows[0].provider).toBe(OAuthProvider.GOOGLE);

      const statusRes = await request(server)
        .get('/api/v1/auth/facebook/deletion-status')
        .query({ code: res.body.confirmation_code })
        .expect(200);
      expect(statusRes.body.status).toBe('pending');
    });

    it('fully soft-deletes the account when Facebook was the only linked OAuth provider', async () => {
      const user = await seedUser(prisma, city.id, { passwordHash: null });
      await prisma.oauth_accounts.create({ data: {
        userId: user.id,
        provider: OAuthProvider.FACEBOOK,
        providerId: 'fb-del-only',
        email: user.email,
      } });

      await request(server)
        .post('/api/v1/auth/facebook/deletion-callback')
        .send({ signed_request: buildSignedRequest(FB_SECRET, { user_id: 'fb-del-only' }) })
        .expect(200);

      const deleted = await prisma.users.findFirst({ where: { id: user.id } });
      expect(deleted!.status).toBe(UserStatus.DELETED);
      expect(deleted!.fullName).toBe('Deleted Member');
    });

    it('fully soft-deletes even when the user also has a password set, since Facebook is their only OAuth link', async () => {
      // Documents the current (narrower) behavior noted above: a user who signed up via
      // Facebook and later also set a password can still be fully soft-deleted by Meta's
      // callback, because handleFacebookDeletion never checks passwordHash.
      const user = await seedUser(prisma, city.id, { passwordHash: await hashPassword(PASSWORD) });
      await prisma.oauth_accounts.create({ data: {
        userId: user.id,
        provider: OAuthProvider.FACEBOOK,
        providerId: 'fb-del-with-password',
        email: user.email,
      } });

      await request(server)
        .post('/api/v1/auth/facebook/deletion-callback')
        .send({ signed_request: buildSignedRequest(FB_SECRET, { user_id: 'fb-del-with-password' }) })
        .expect(200);

      const deleted = await prisma.users.findFirst({ where: { id: user.id } });
      expect(deleted!.status).toBe(UserStatus.DELETED);
    });

    it('returns not_found for an unknown confirmation code', async () => {
      const res = await request(server).get('/api/v1/auth/facebook/deletion-status').query({ code: 'nonexistent' }).expect(200);
      expect(res.body.status).toBe('not_found');
    });

    it('still records a deletion request when no matching Facebook account exists', async () => {
      const res = await request(server)
        .post('/api/v1/auth/facebook/deletion-callback')
        .send({ signed_request: buildSignedRequest(FB_SECRET, { user_id: 'fb-unknown-999' }) })
        .expect(200);

      const record = await prisma.facebook_deletion_requests
        .findFirst({ where: { confirmationCode: res.body.confirmation_code } });
      expect(record).toBeTruthy();
      expect(record!.dinnerbearsUserId).toBeNull();
      expect(record!.status).toBe(FacebookDeletionStatus.PENDING);
    });
  });
});
