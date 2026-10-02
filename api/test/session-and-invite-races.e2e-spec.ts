import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables, resetThrottler, TEST_TENANT_DOMAIN } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';
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
});
