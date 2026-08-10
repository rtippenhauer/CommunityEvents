import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { achievements as Achievement, cities as City, locations as Location, users as User } from '@prisma/client';
import { UserRole } from '../src/database/enums';

describe('Event-scoped achievement retroactive sync (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
  let location: Location;
  let admin: User;
  let memberA: User;
  let memberB: User;
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
    city = await seedCity(prisma);
    location = await seedLocation(prisma, city.id);

    admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    memberA = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member-a@example.test' });
    memberB = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member-b@example.test' });
    adminCookie = await loginAs(app, admin);

    // The real secret-dinner achievement tiers are seed data inserted once by
    // migrations at app boot, not per-test fixture data — but truncateAllTables
    // (shared with every other spec file) wipes it along with everything else.
    // Re-seed just the tier this spec exercises so checkSecretDinnerAchievements
    // has something to find/grant/revoke.
    await prisma.achievements.createMany({ data: [
      { key: 'secret_dinner_1', name: 'Mystery Diner', description: 'd', points: 5 },
    ] });
  });

  async function createAttendedEvent(overrides: Record<string, unknown> = {}): Promise<number> {
    const created = await request(server)
      .post('/api/v1/events')
      .set('Cookie', adminCookie)
      .send({
        cityId: city.id,
        locationId: location.id,
        title: 'Test Dinner',
        eventDate: '2027-01-05',
        eventTime: '18:30',
        status: 'published',
        ...overrides,
      })
      .expect(201);
    const eventId = created.body.id;

    for (const member of [memberA, memberB]) {
      const memberCookie = await loginAs(app, member);
      await request(server)
        .post(`/api/v1/events/${eventId}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going', additionalGuests: 0 })
        .expect(201);
    }

    await request(server)
      .patch(`/api/v1/events/${eventId}/attendance`)
      .set('Cookie', adminCookie)
      .send({
        attendances: [
          { userId: memberA.id, attended: true },
          { userId: memberB.id, attended: true },
        ],
      })
      .expect(200);

    return eventId;
  }

  async function getLedger(userId: number) {
    const res = await request(server)
      .get(`/api/v1/admin/members/${userId}/points/ledger`)
      .set('Cookie', adminCookie)
      .expect(200);
    return res.body as { pointType: string; referenceId: number }[];
  }

  async function getAchievements(userId: number) {
    const res = await request(server)
      .get(`/api/v1/admin/members/${userId}/achievements`)
      .set('Cookie', adminCookie)
      .expect(200);
    return res.body as { key: string; name: string; earned: boolean }[];
  }

  describe('toggling is_secret on an already-attended event', () => {
    it('retroactively awards secret_dinner points + Mystery Diner to existing attendees when enabled', async () => {
      const eventId = await createAttendedEvent();

      const res = await request(server)
        .patch(`/api/v1/events/${eventId}`)
        .set('Cookie', adminCookie)
        .send({ isSecret: true })
        .expect(200);

      expect(res.body.secretDinnerResync).toEqual({ enabled: true, awarded: 2 });

      for (const member of [memberA, memberB]) {
        const ledger = await getLedger(member.id);
        expect(ledger.some((r) => r.pointType === 'secret_dinner' && r.referenceId === eventId)).toBe(true);
        const achievements = await getAchievements(member.id);
        expect(achievements.find((a) => a.key === 'secret_dinner_1')?.earned).toBe(true);
      }
    });

    it('retracts secret_dinner points + revokes the achievement when un-marked as secret', async () => {
      const eventId = await createAttendedEvent({ isSecret: true });

      // First confirm they were awarded to begin with (created secret from the start).
      for (const member of [memberA, memberB]) {
        const achievements = await getAchievements(member.id);
        expect(achievements.find((a) => a.key === 'secret_dinner_1')?.earned).toBe(true);
      }

      const res = await request(server)
        .patch(`/api/v1/events/${eventId}`)
        .set('Cookie', adminCookie)
        .send({ isSecret: false })
        .expect(200);

      expect(res.body.secretDinnerResync).toEqual({ enabled: false, removed: 2 });

      for (const member of [memberA, memberB]) {
        const ledger = await getLedger(member.id);
        expect(ledger.some((r) => r.pointType === 'secret_dinner')).toBe(false);
        const achievements = await getAchievements(member.id);
        expect(achievements.find((a) => a.key === 'secret_dinner_1')?.earned).toBe(false);
      }
    });

    it('does not include secretDinnerResync when isSecret is unchanged', async () => {
      const eventId = await createAttendedEvent();

      const res = await request(server)
        .patch(`/api/v1/events/${eventId}`)
        .set('Cookie', adminCookie)
        .send({ title: 'Renamed Dinner' })
        .expect(200);

      expect(res.body.secretDinnerResync).toBeUndefined();
    });
  });

  describe('per-event "Special Dinner Achievement"', () => {
    it('retroactively grants the achievement to already-attended members on create', async () => {
      const eventId = await createAttendedEvent();

      const res = await request(server)
        .post(`/api/v1/admin/events/${eventId}/achievement`)
        .set('Cookie', adminCookie)
        .send({ name: 'Special Bear', description: 'You were there.', points: 5 })
        .expect(201);

      expect(res.body.attendeesChecked).toBe(2);

      for (const member of [memberA, memberB]) {
        const achievements = await getAchievements(member.id);
        const earned = achievements.find((a) => a.name === 'Special Bear');
        expect(earned?.earned).toBe(true);
        const ledger = await getLedger(member.id);
        expect(ledger.some((r) => r.pointType === 'achievement')).toBe(true);
      }
    });

    it('removes the achievement and claws back points/badges on delete', async () => {
      const eventId = await createAttendedEvent();
      await request(server)
        .post(`/api/v1/admin/events/${eventId}/achievement`)
        .set('Cookie', adminCookie)
        .send({ name: 'Special Bear', description: 'You were there.', points: 5 })
        .expect(201);

      const res = await request(server)
        .delete(`/api/v1/admin/events/${eventId}/achievement`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body).toEqual({ removedAchievements: 2, removedPoints: 2 });

      for (const member of [memberA, memberB]) {
        const achievements = await getAchievements(member.id);
        expect(achievements.some((a) => a.name === 'Special Bear')).toBe(false);
        const ledger = await getLedger(member.id);
        expect(ledger.some((r) => r.pointType === 'achievement')).toBe(false);
      }

      // The controller returns `null` here, which serializes as an empty
      // body — supertest represents that as `{}`, not `null` (confirmed
      // against the same "no achievement" case on prod).
      const publicRes = await request(server)
        .get(`/api/v1/events/${eventId}/achievement`)
        .expect(200);
      expect(publicRes.body).toEqual({});
    });

    it('404s deleting an achievement that does not exist', async () => {
      const eventId = await createAttendedEvent();
      await request(server)
        .delete(`/api/v1/admin/events/${eventId}/achievement`)
        .set('Cookie', adminCookie)
        .expect(404);
    });

    it('rejects non-admins from creating or deleting an event achievement', async () => {
      const eventId = await createAttendedEvent();
      const memberCookie = await loginAs(app, memberA);

      await request(server)
        .post(`/api/v1/admin/events/${eventId}/achievement`)
        .set('Cookie', memberCookie)
        .send({ name: 'Special Bear', description: 'You were there.', points: 5 })
        .expect(403);

      await request(server)
        .delete(`/api/v1/admin/events/${eventId}/achievement`)
        .set('Cookie', memberCookie)
        .expect(403);
    });
  });
});
