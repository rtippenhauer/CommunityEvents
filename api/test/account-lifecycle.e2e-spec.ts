import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { CityEntity } from '../src/database/entities/city.entity';
import { LocationEntity } from '../src/database/entities/location.entity';
import { UserEntity, UserRole, UserStatus } from '../src/database/entities/user.entity';
import { OAuthAccountEntity, OAuthProvider } from '../src/database/entities/oauth-account.entity';
import { LoginSessionEntity } from '../src/database/entities/login-session.entity';
import { PushSubscriptionEntity } from '../src/database/entities/push-subscription.entity';
import { EventRsvpEntity, RsvpStatus } from '../src/database/entities/event-rsvp.entity';
import { InviteEntity, InviteType, InviteFlavor } from '../src/database/entities/invite.entity';
import { FacebookDeletionRequestEntity, FacebookDeletionStatus } from '../src/database/entities/facebook-deletion-request.entity';
import { HardDeleteTask } from '../src/modules/tasks/hard-delete.task';

describe('Account Lifecycle (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];

  let city: CityEntity;
  let location: LocationEntity;
  let adminCookie: string;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    resetThrottler(app);
    city = await seedCity(dataSource);
    location = await seedLocation(dataSource, city.id);
    const admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
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
      const user = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'selfdelete@example.test' });
      const cookie = await loginAs(app, user);
      await dataSource.getRepository(OAuthAccountEntity).save({
        userId: user.id,
        provider: OAuthProvider.GOOGLE,
        providerId: 'google-self-delete',
        email: user.email,
      });
      await dataSource.getRepository(PushSubscriptionEntity).save({
        userId: user.id,
        endpoint: 'https://push.example.test/endpoint',
        p256dh: 'p256dh-key',
        auth: 'auth-secret',
      });

      await request(server).delete('/api/v1/users/me').set('Cookie', cookie).send({ confirm: 'DELETE' }).expect(204);

      const deleted = await dataSource.getRepository(UserEntity).findOne({ where: { id: user.id } });
      expect(deleted!.status).toBe(UserStatus.DELETED);
      expect(deleted!.deletedAt).toBeTruthy();
      expect(deleted!.fullName).toBe('Deleted Member');
      expect(deleted!.email).toBe(`deleted-${user.id}@deleted.dinnerbears.com`);
      expect(deleted!.passwordHash).toBeNull();

      const hardDeleteAt = deleted!.hardDeleteAt!.getTime();
      const expected30d = Date.now() + 30 * 24 * 60 * 60 * 1000;
      expect(Math.abs(hardDeleteAt - expected30d)).toBeLessThan(5 * 60 * 1000);

      const oauthRows = await dataSource.getRepository(OAuthAccountEntity).find({ where: { userId: user.id } });
      expect(oauthRows).toHaveLength(0);
      const sessions = await dataSource.getRepository(LoginSessionEntity).find({ where: { userId: user.id } });
      expect(sessions).toHaveLength(0);
      const pushSubs = await dataSource.getRepository(PushSubscriptionEntity).find({ where: { userId: user.id } });
      expect(pushSubs).toHaveLength(0);

      // The session cookie used to issue the delete request is now invalid
      await request(server).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    });

    it('cancels RSVPs on upcoming events and revokes event invite links the user created', async () => {
      const event = await createUpcomingEvent();
      const user = await seedUser(dataSource, city.id, { role: UserRole.MODERATOR, email: 'coordinator@example.test' });
      const cookie = await loginAs(app, user);

      await dataSource.getRepository(EventRsvpEntity).save({ userId: user.id, eventId: event.id, status: RsvpStatus.GOING });
      const inviteRepo = dataSource.getRepository(InviteEntity);
      const invite = await inviteRepo.save(
        inviteRepo.create({
          token: `self-delete-invite-${Date.now()}`,
          type: InviteType.EVENT_INVITE,
          createdBy: user.id,
          eventId: event.id,
          inviteFlavor: InviteFlavor.NON_VALIDATED,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          maxUses: 10,
        }),
      );

      await request(server).delete('/api/v1/users/me').set('Cookie', cookie).send({ confirm: 'DELETE' }).expect(204);

      const rsvp = await dataSource.getRepository(EventRsvpEntity).findOne({ where: { userId: user.id, eventId: event.id } });
      expect(rsvp).toBeNull();
      const updatedInvite = await inviteRepo.findOne({ where: { id: invite.id } });
      expect(updatedInvite!.isRevoked).toBe(true);
    });

    it('rejects a missing or incorrect confirmation string', async () => {
      const user = await seedUser(dataSource, city.id, { role: UserRole.MEMBER });
      const cookie = await loginAs(app, user);

      await request(server).delete('/api/v1/users/me').set('Cookie', cookie).send({}).expect(400);
      await request(server).delete('/api/v1/users/me').set('Cookie', cookie).send({ confirm: 'delete' }).expect(400);
    });

    it('rejects self-deletion for an admin account', async () => {
      const admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin-self@example.test' });
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
      const user = await seedUser(dataSource, city.id, {
        status: UserStatus.DELETED,
        deletedAt: new Date(),
        hardDeleteAt: past,
        email: `deleted-hard-${Date.now()}@deleted.dinnerbears.com`,
        passwordHash: 'still-set',
      });

      await app.get(HardDeleteTask).runHardDelete();

      const hardDeleted = await dataSource.getRepository(UserEntity).findOne({ where: { id: user.id } });
      expect(hardDeleted!.fullName).toBe('Deleted Member');
      expect(hardDeleted!.email).toBe(`deleted-${user.id}@deleted.dinnerbears.com`);
      expect(hardDeleted!.passwordHash).toBeNull();
      expect(hardDeleted!.emailVerifiedAt).toBeNull();
      expect(hardDeleted!.hardDeleteAt).toBeNull();
    });

    it('leaves accounts alone that are not yet due for hard-delete', async () => {
      const future = new Date();
      future.setDate(future.getDate() + 10);
      const user = await seedUser(dataSource, city.id, {
        status: UserStatus.DELETED,
        deletedAt: new Date(),
        hardDeleteAt: future,
        fullName: 'Still Recoverable',
      });

      await app.get(HardDeleteTask).runHardDelete();

      const untouched = await dataSource.getRepository(UserEntity).findOne({ where: { id: user.id } });
      expect(untouched!.fullName).toBe('Still Recoverable');
    });

    it('leaves active accounts alone even if a hardDeleteAt happens to be set in the past', async () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const user = await seedUser(dataSource, city.id, {
        status: UserStatus.ACTIVE,
        hardDeleteAt: past,
        fullName: 'Still Active',
      });

      await app.get(HardDeleteTask).runHardDelete();

      const untouched = await dataSource.getRepository(UserEntity).findOne({ where: { id: user.id } });
      expect(untouched!.fullName).toBe('Still Active');
    });

    it('marks pending Facebook deletion requests for the user as completed', async () => {
      const past = new Date();
      past.setDate(past.getDate() - 1);
      const user = await seedUser(dataSource, city.id, {
        status: UserStatus.DELETED,
        deletedAt: new Date(),
        hardDeleteAt: past,
      });
      const fbDeletionRepo = dataSource.getRepository(FacebookDeletionRequestEntity);
      const fbRequest = await fbDeletionRepo.save({
        facebookUserId: 'fb-hard-delete-user',
        confirmationCode: `CODE-${Date.now()}`,
        dinnerbearsUserId: user.id,
        status: FacebookDeletionStatus.PENDING,
      });

      await app.get(HardDeleteTask).runHardDelete();

      const updated = await fbDeletionRepo.findOne({ where: { id: fbRequest.id } });
      expect(updated!.status).toBe(FacebookDeletionStatus.COMPLETED);
      expect(updated!.completedAt).toBeTruthy();
    });
  });
});
