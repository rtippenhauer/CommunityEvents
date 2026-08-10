import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { HardDeleteTask } from '../src/modules/tasks/hard-delete.task';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City, event_rsvps as EventRsvp, facebook_deletion_requests as FacebookDeletionRequest, invites as Invite, locations as Location, login_sessions as LoginSession, oauth_accounts as OAuthAccount, push_subscriptions as PushSubscription, users as User } from '@prisma/client';
import { FacebookDeletionStatus, InviteFlavor, InviteType, OAuthProvider, RsvpStatus, UserRole, UserStatus } from '../src/database/enums';

describe('Account Lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
  let location: Location;
  let adminCookie: string;

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
    location = await seedLocation(prisma, city.id);
    const admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    adminCookie = await loginAs(app, admin);
  });

  async function createUpcomingEvent(): Promise<{ id: number }> {
    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 14);
    const created = await request(server)
      .post('/api/v1/events')
      .set('Cookie', adminCookie)
      .send({
        cityId: city.id,
        locationId: location.id,
        title: 'Upcoming Dinner',
        eventDate: eventDate.toISOString().slice(0, 10),
        eventTime: '18:30',
      })
      .expect(201);
    await request(server)
      .patch(`/api/v1/events/${created.body.id}`)
      .set('Cookie', adminCookie)
      .send({ status: 'published' })
      .expect(200);
    return created.body;
  }

  describe('DELETE /users/me (self-delete)', () => {
    it('soft-deletes the account and scrubs sessions, oauth links, and push subscriptions', async () => {
      const user = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'selfdelete@example.test' });
      const cookie = await loginAs(app, user);
      await prisma.oauth_accounts.create({ data: {
        userId: user.id,
        provider: OAuthProvider.GOOGLE,
        providerId: 'google-self-delete',
        email: user.email,
      } });
      await prisma.push_subscriptions.create({ data: {
        userId: user.id,
        endpoint: 'https://push.example.test/endpoint',
        p256dh: 'p256dh-key',
        auth: 'auth-secret',
      } });

      await request(server).delete('/api/v1/users/me').set('Cookie', cookie).send({ confirm: 'DELETE' }).expect(204);

      const deleted = await prisma.users.findFirst({ where: { id: user.id } });
      expect(deleted!.status).toBe(UserStatus.DELETED);
      expect(deleted!.deletedAt).toBeTruthy();
      expect(deleted!.fullName).toBe('Deleted Member');
      expect(deleted!.email).toBe(`deleted-${user.id}@deleted.dinnerbears.com`);
      expect(deleted!.passwordHash).toBeNull();

      const hardDeleteAt = deleted!.hardDeleteAt!.getTime();
      const expected30d = Date.now() + 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs(hardDeleteAt - expected30d)).toBeLessThan(5 * 60 * 1000);

      const oauthRows = await prisma.oauth_accounts.findMany({ where: { userId: user.id } });
      expect(oauthRows).toHaveLength(0);
      const sessions = await prisma.login_sessions.findMany({ where: { userId: user.id } });
      expect(sessions).toHaveLength(0);
      const pushSubs = await prisma.push_subscriptions.findMany({ where: { userId: user.id } });
      expect(pushSubs).toHaveLength(0);

      // The session cookie used to issue the delete request is now invalid
      await request(server).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    });

    it('cancels RSVPs on upcoming events and revokes event invite links the user created', async () => {
      const event = await createUpcomingEvent();
      const user = await seedUser(prisma, city.id, { role: UserRole.MODERATOR, email: 'coordinator@example.test' });
      const cookie = await loginAs(app, user);

      await prisma.event_rsvps.create({ data: { userId: user.id, eventId: event.id, status: RsvpStatus.GOING } });
      const invite = await prisma.invites.create({ data: {
          token: `self-delete-invite-${Date.now()}`,
          type: InviteType.EVENT_INVITE,
          createdBy: user.id,
          eventId: event.id,
          inviteFlavor: InviteFlavor.NON_VALIDATED,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          maxUses: 10,
        }, });

      await request(server).delete('/api/v1/users/me').set('Cookie', cookie).send({ confirm: 'DELETE' }).expect(204);

      const rsvp = await prisma.event_rsvps.findFirst({ where: { userId: user.id, eventId: event.id } });
      expect(rsvp).toBeNull();
      const updatedInvite = await prisma.invites.findFirst({ where: { id: invite.id } });
      expect(updatedInvite!.isRevoked).toBe(true);
    });

    it('rejects a missing or incorrect confirmation string', async () => {
      const user = await seedUser(prisma, city.id, { role: UserRole.MEMBER });
      const cookie = await loginAs(app, user);

      await request(server).delete('/api/v1/users/me').set('Cookie', cookie).send({}).expect(400);
      await request(server).delete('/api/v1/users/me').set('Cookie', cookie).send({ confirm: 'delete' }).expect(400);
    });

    it('rejects self-deletion for an admin account', async () => {
      const admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin-self@example.test' });
      const cookie = await loginAs(app, admin);

      await request(server).delete('/api/v1/users/me').set('Cookie', cookie).send({ confirm: 'DELETE' }).expect(403);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).delete('/api/v1/users/me').send({ confirm: 'DELETE' }).expect(401);
    });
  });

  describe('Hard-delete cron (HardDeleteTask.runHardDelete)', () => {
    it('scrubs PII for accounts past their hard-delete date', async () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const user = await seedUser(prisma, city.id, {
        status: UserStatus.DELETED,
        deletedAt: new Date(),
        hardDeleteAt: past,
        email: `deleted-hard-${Date.now()}@deleted.dinnerbears.com`,
        passwordHash: 'still-set',
      });

      await app.get(HardDeleteTask).runHardDelete();

      const hardDeleted = await prisma.users.findFirst({ where: { id: user.id } });
      expect(hardDeleted!.fullName).toBe('Deleted Member');
      expect(hardDeleted!.email).toBe(`deleted-${user.id}@deleted.dinnerbears.com`);
      expect(hardDeleted!.passwordHash).toBeNull();
      expect(hardDeleted!.emailVerifiedAt).toBeNull();
      expect(hardDeleted!.hardDeleteAt).toBeNull();
    });

    it('leaves accounts alone that are not yet due for hard-delete', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 10);
      const user = await seedUser(prisma, city.id, {
        status: UserStatus.DELETED,
        deletedAt: new Date(),
        hardDeleteAt: future,
        fullName: 'Still Recoverable',
      });

      await app.get(HardDeleteTask).runHardDelete();

      const untouched = await prisma.users.findFirst({ where: { id: user.id } });
      expect(untouched!.fullName).toBe('Still Recoverable');
    });

    it('leaves active accounts alone even if a hardDeleteAt happens to be set in the past', async () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const user = await seedUser(prisma, city.id, {
        status: UserStatus.ACTIVE,
        hardDeleteAt: past,
        fullName: 'Still Active',
      });

      await app.get(HardDeleteTask).runHardDelete();

      const untouched = await prisma.users.findFirst({ where: { id: user.id } });
      expect(untouched!.fullName).toBe('Still Active');
    });

    it('marks pending Facebook deletion requests for the user as completed', async () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const user = await seedUser(prisma, city.id, {
        status: UserStatus.DELETED,
        deletedAt: new Date(),
        hardDeleteAt: past,
      });
      const fbRequest = await prisma.facebook_deletion_requests.create({ data: {
        facebookUserId: 'fb-hard-delete-user',
        confirmationCode: `CODE-${Date.now()}`,
        dinnerbearsUserId: user.id,
        status: FacebookDeletionStatus.PENDING,
      } });

      await app.get(HardDeleteTask).runHardDelete();

      const updated = await prisma.facebook_deletion_requests.findFirst({ where: { id: fbRequest.id } });
      expect(updated!.status).toBe(FacebookDeletionStatus.COMPLETED);
      expect(updated!.completedAt).toBeTruthy();
    });
  });
});
