import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables, resetThrottler, TEST_TENANT_DOMAIN } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
import { EmailService } from '../src/modules/email/email.service';
import { InvitesService } from '../src/modules/invites/invites.service';
import { runUnscoped } from '../src/common/tenant/tenant-store';
import { InviteType, UserRole } from '../src/database/enums';
import * as bcrypt from 'bcrypt';
import type { cities as City, users as User } from '@prisma/client';

const unscoped = <T>(reason: string, fn: () => Promise<T>): Promise<T> =>
  runUnscoped(reason, async () => await fn());

/**
 * Two defects at the same boundary: state that was read, decided on, and only
 * then written (review, 2026-10-02).
 *
 * The suite could not have caught either, because both need two things to
 * happen at once and every existing test drives one request at a time.
 */
describe('Session revocation and invite races (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let authService: AuthService;
  let invitesService: InvitesService;
  let city: City;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
    authService = app.get(AuthService);
    invitesService = app.get(InvitesService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    resetThrottler(app);
    city = await seedCity(prisma);
  });

  /**
   * A password reset exists mostly for the case where somebody believes their
   * account is compromised. `JwtStrategy` checks `login_sessions.is_active` on
   * every request — which is what makes sessions revocable — and the reset did
   * nothing with it. So the owner changed the password and the attacker's stolen
   * cookie kept working: exactly backwards.
   */
  describe('password reset revokes sessions', () => {
    const resetTokenFor = async (user: User): Promise<string> => {
      const token = 'reset-token-for-test';
      await unscoped('planting a reset token', () =>
        prisma.users.update({
          where: { id: user.id },
          data: {
            passwordResetToken: token,
            passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
          },
        }),
      );
      return token;
    };

    it('kills a session that existed before the reset', async () => {
      const user = await seedUser(prisma, city.id, { email: 'reset@example.test' });
      const cookie = await loginAs(app, user);

      // The session works beforehand -- otherwise this test could pass for the
      // wrong reason.
      await request(server)
        .get('/api/v1/auth/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', cookie)
        .expect(200);

      await authService.resetPassword(await resetTokenFor(user), 'NewPassw0rd!x');

      await request(server)
        .get('/api/v1/auth/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', cookie)
        .expect(401);
    });

    it('kills every session, not only one', async () => {
      const user = await seedUser(prisma, city.id, { email: 'multi@example.test' });
      const first = await loginAs(app, user);
      const second = await loginAs(app, user);

      await authService.resetPassword(await resetTokenFor(user), 'NewPassw0rd!x');

      for (const cookie of [first, second]) {
        await request(server)
          .get('/api/v1/auth/me')
          .set('Host', TEST_TENANT_DOMAIN)
          .set('Cookie', cookie)
          .expect(401);
      }

      const live = await unscoped('counting live sessions', () =>
        prisma.login_sessions.count({ where: { userId: user.id, isActive: true } }),
      );
      expect(live).toBe(0);
    });

    it('leaves another member\'s sessions alone', async () => {
      const user = await seedUser(prisma, city.id, { email: 'reset2@example.test' });
      const bystander = await seedUser(prisma, city.id, { email: 'bystander@example.test' });
      const theirs = await loginAs(app, bystander);

      await authService.resetPassword(await resetTokenFor(user), 'NewPassw0rd!x');

      await request(server)
        .get('/api/v1/auth/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', theirs)
        .expect(200);
    });
  });

  /**
   * A password *change* is the other half, and deliberately not the same.
   * Somebody changing their password proved the old one and is holding a working
   * session, so signing them out of the tab they are in would be hostile. What
   * it must still do is evict anyone else holding a session minted under the old
   * password.
   */
  describe('password change revokes other sessions but not this one', () => {
    it('keeps the caller signed in and drops the rest', async () => {
      // Hashed directly: seedUser takes column overrides, and changePassword
      // compares against the stored hash.
      const user = await seedUser(prisma, city.id, {
        email: 'change@example.test',
        passwordHash: await bcrypt.hash('OldPassw0rd!x', 12),
      });
      const stale = await loginAs(app, user);
      const current = await loginAs(app, user);

      await request(server)
        .patch('/api/v1/auth/password')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', current)
        .send({ currentPassword: 'OldPassw0rd!x', newPassword: 'NewPassw0rd!x' })
        .expect(200);

      // The tab that made the change still works...
      await request(server)
        .get('/api/v1/auth/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', current)
        .expect(200);

      // ...and the other one does not.
      await request(server)
        .get('/api/v1/auth/me')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', stale)
        .expect(401);
    });
  });

  /**
   * `redeem` computed the new count from the row the caller had already loaded,
   * so two redemptions that both read `useCount: 9` against `maxUses: 10` both
   * wrote 10 and both succeeded — eleven people through a ten-use invite, with
   * the stored count reading ten and nothing to show for the extra.
   */
  describe('invite use count is atomic', () => {
    const makeInvite = async (maxUses: number, useCount: number) => {
      const creator = await seedUser(prisma, city.id, {
        role: UserRole.ADMIN,
        email: `creator-${maxUses}-${useCount}@example.test`,
      });
      // Not wrapped in runUnscoped: `invites` is scoped, so a waived create
      // takes the tenant_id sentinel and the foreign key rejects it. Seeded
      // through the scoped client exactly as seedUser is.
      return prisma.invites.create({
          data: {
            token: `tok-${maxUses}-${useCount}-${Date.now()}`,
            type: InviteType.EVENT_INVITE,
            createdBy: creator.id,
            maxUses,
            useCount,
            expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    };

    it('lets only one of two concurrent redemptions take the last use', async () => {
      const invite = await makeInvite(10, 9);
      const [a, b] = await Promise.all([
        seedUser(prisma, city.id, { email: 'racer-a@example.test' }),
        seedUser(prisma, city.id, { email: 'racer-b@example.test' }),
      ]);

      // Both hold the same stale row, which is exactly the shape of the bug:
      // two requests that validated before either spent a use.
      const results = await Promise.allSettled([
        invitesService.redeem(invite, a),
        invitesService.redeem(invite, b),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);

      const after = await unscoped('reading the invite', () =>
        prisma.invites.findUnique({ where: { id: invite.id } }),
      );
      // Ten uses of a ten-use invite, never eleven.
      expect(after!.useCount).toBe(10);
      expect(after!.redeemedAt).not.toBeNull();
    });

    it('refuses to spend an invite that is already exhausted', async () => {
      const invite = await makeInvite(1, 1);
      const user = await seedUser(prisma, city.id, { email: 'late@example.test' });

      await expect(invitesService.redeem(invite, user)).rejects.toThrow();

      const after = await unscoped('reading the invite', () =>
        prisma.invites.findUnique({ where: { id: invite.id } }),
      );
      expect(after!.useCount).toBe(1);
    });

    it('still counts an unlimited invite without ever exhausting it', async () => {
      const creator = await seedUser(prisma, city.id, {
        role: UserRole.ADMIN,
        email: 'unlimited@example.test',
      });
      const invite = await prisma.invites.create({
          data: {
            token: `tok-unlimited-${Date.now()}`,
            type: InviteType.EVENT_INVITE,
            createdBy: creator.id,
            maxUses: null,
          useCount: 0,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      const user = await seedUser(prisma, city.id, { email: 'anyone@example.test' });

      await invitesService.redeem(invite, user);
      await invitesService.redeem(invite, user);

      const after = await unscoped('reading the invite', () =>
        prisma.invites.findUnique({ where: { id: invite.id } }),
      );
      expect(after!.useCount).toBe(2);
      // Never marked spent, because there is no limit to reach.
      expect(after!.redeemedAt).toBeNull();
    });
  });

  /**
   * A provider account may only be attached to the account with the same email
   * address (Rob, 2026-10-02).
   *
   * Linking compared nothing before this: the provider's address was stored and
   * never checked against `users.email`. Since sign-in resolves on `providerId`
   * alone with no password in the path, a link is a second permanent credential
   * — so anyone holding a session could attach their own Google account and keep
   * access through a password reset. Rob found it by asking whether a reset
   * actually evicts somebody who authenticated before it.
   */
  describe('linking a provider requires a matching address', () => {
    const PROVIDER_ID = 'google-abc-123';

    it('allows a link when the addresses match', async () => {
      const user = await seedUser(prisma, city.id, { email: 'same@example.test' });

      await authService.linkGoogle(user.id, PROVIDER_ID, 'same@example.test');

      const link = await unscoped('reading the link', () =>
        prisma.oauth_accounts.findFirst({ where: { userId: user.id } }),
      );
      expect(link).not.toBeNull();
      expect(link!.providerId).toBe(PROVIDER_ID);
    });

    it('is case- and whitespace-insensitive about the match', async () => {
      const user = await seedUser(prisma, city.id, { email: 'casing@example.test' });

      await authService.linkGoogle(user.id, PROVIDER_ID, '  Casing@Example.Test  ');

      expect(
        await unscoped('counting links', () =>
          prisma.oauth_accounts.count({ where: { userId: user.id } }),
        ),
      ).toBe(1);
    });

    /**
     * The attack this closes, end to end: the attacker holds the password, so
     * they hold a session, and the one thing they must not be able to do is
     * leave a credential of their own behind.
     */
    it('refuses a provider account on a different address', async () => {
      const victim = await seedUser(prisma, city.id, { email: 'victim@example.test' });

      await expect(
        authService.linkGoogle(victim.id, 'attacker-google-id', 'attacker@evil.test'),
      ).rejects.toMatchObject({ response: { reason: 'provider_email_mismatch' } });

      expect(
        await unscoped('counting links', () =>
          prisma.oauth_accounts.count({ where: { userId: victim.id } }),
        ),
      ).toBe(0);
    });

    /**
     * Fails closed. Facebook does not always return an address, and "nothing to
     * compare" must not read as "allowed" — that is exactly where somebody would
     * aim by dropping the email scope.
     */
    it('refuses when the provider shared no address at all', async () => {
      const user = await seedUser(prisma, city.id, { email: 'noemail@example.test' });

      await expect(
        authService.linkFacebook(user.id, 'fb-id-1', null, null),
      ).rejects.toMatchObject({ response: { reason: 'provider_email_missing' } });

      expect(
        await unscoped('counting links', () =>
          prisma.oauth_accounts.count({ where: { userId: user.id } }),
        ),
      ).toBe(0);
    });

    // Facebook follows the same rule as Google. The codebase has twice had to
    // fix an asymmetry where one provider enforced something the other did not.
    it('applies to Facebook as well', async () => {
      const user = await seedUser(prisma, city.id, { email: 'fb@example.test' });

      await expect(
        authService.linkFacebook(user.id, 'fb-id-2', 'other@example.test', null),
      ).rejects.toMatchObject({ response: { reason: 'provider_email_mismatch' } });

      await authService.linkFacebook(user.id, 'fb-id-2', 'fb@example.test', null);
      expect(
        await unscoped('counting links', () =>
          prisma.oauth_accounts.count({ where: { userId: user.id } }),
        ),
      ).toBe(1);
    });

    // The pre-existing guard still works and is still reported differently: a
    // provider account already attached elsewhere is a conflict, not a mismatch.
    it('still refuses a provider account attached to somebody else', async () => {
      const first = await seedUser(prisma, city.id, { email: 'first@example.test' });
      const second = await seedUser(prisma, city.id, { email: 'second@example.test' });

      await authService.linkGoogle(first.id, 'shared-google-id', 'first@example.test');

      await expect(
        authService.linkGoogle(second.id, 'shared-google-id', 'second@example.test'),
      ).rejects.toThrow(/already linked/i);
    });
  });

  /**
   * A password change now says so by email (Rob, 2026-10-02).
   *
   * A reset is self-announcing — the member asked for it and the link arrived in
   * their own mailbox — but a change involved no mail at all, so somebody whose
   * password was changed by a person holding their session had no signal
   * whatsoever. This notice is the only one that reaches an address the person
   * making the change may not control.
   */
  describe('a password change is announced by email', () => {
    const changePassword = async (email: string) => {
      const user = await seedUser(prisma, city.id, {
        email,
        passwordHash: await bcrypt.hash('OldPassw0rd!x', 12),
      });
      await authService.changePassword(user.id, 'OldPassw0rd!x', 'NewPassw0rd!x');
      return user;
    };

    it('mails the account owner', async () => {
      const user = await changePassword('notify@example.test');

      const mail = await unscoped('reading the mail log', () =>
        prisma.email_queue.findMany({ where: { toEmail: user.email } }),
      );
      expect(mail).toHaveLength(1);
      expect(mail[0].subject).toMatch(/password was changed/i);
    });

    // The notice has to carry the way out, because the member reading it may be
    // the one person who did not make the change.
    it('tells them how to take the account back', async () => {
      await changePassword('recover@example.test');

      const mail = await unscoped('reading the mail log', () =>
        prisma.email_queue.findFirst({ where: { toEmail: 'recover@example.test' } }),
      );
      expect(mail!.htmlBody).toContain('/auth/forgot-password');
    });

    // A failed send must not fail the change: the password is already updated
    // and the other sessions already revoked.
    it('still changes the password if the notice cannot be sent', async () => {
      const user = await seedUser(prisma, city.id, {
        email: 'mailfail@example.test',
        passwordHash: await bcrypt.hash('OldPassw0rd!x', 12),
      });
      const email = app.get(EmailService);
      const original = email.sendNow.bind(email);
      (email as unknown as { sendNow: () => Promise<void> }).sendNow = async () => {
        throw new Error('provider down');
      };

      await authService.changePassword(user.id, 'OldPassw0rd!x', 'NewPassw0rd!x');

      (email as unknown as { sendNow: typeof original }).sendNow = original;

      const after = await unscoped('reading the user', () =>
        prisma.users.findUnique({ where: { id: user.id } }),
      );
      expect(await bcrypt.compare('NewPassw0rd!x', after!.passwordHash!)).toBe(true);
    });
  });
});
