import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City, event_rsvps as EventRsvp, events as Event, locations as Location, users as User } from '@prisma/client';
import { RsvpStatus, UserRole } from '../src/database/enums';
import { toDateColumn, toTimeColumn } from '../src/common/utils/prisma-date.util';

// Phase 37: residences are not rateable. The mechanism is Phase 33's
// `feature_ratings_residences` toggle; what changed is that it now defaults
// OFF. These tests pin the default, since a silently flipped-back default
// would restore exactly the behavior this phase set out to remove.
describe('Residence ratings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
  let admin: User;
  let member: User;
  let memberCookie: string;
  let adminCookie: string;
  let residence: Location;
  let restaurant: Location;

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
    admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);

    residence = await seedLocation(prisma, city.id, {
      name: "Someone's House",
      isResidence: true,
    });
    restaurant = await seedLocation(prisma, city.id, { name: 'A Real Restaurant' });
  });

  // A rateable visit: a past event at `location` that `member` attended.
  // Seeded directly rather than through the API, since the events endpoint
  // won't accept a date in the past.
  async function seedAttendedPastEvent(location: Location): Promise<Event> {
    const event = await prisma.events.create({ data: {
        cityId: city.id,
        locationId: location.id,
        locationName: location.name,
        locationAddress: location.address,
        createdById: admin.id,
        title: `Dinner at ${location.name}`,
        // DATE/TIME columns are Date objects under Prisma; the spec keeps
        // speaking in the 'YYYY-MM-DD' / 'HH:MM' strings the API accepts.
        eventDate: toDateColumn('2020-01-05'),
        eventTime: toTimeColumn('18:30'),
      }, });
    await prisma.event_rsvps.create({ data: {
        eventId: event.id,
        userId: member.id,
        status: RsvpStatus.GOING,
        attended: true,
      }, });
    return event;
  }

  const validRating = (eventId: number) => ({
    eventId,
    food: 5,
    service: 5,
    valueRating: 5,
    noise: 3,
  });

  async function setResidenceRatings(enabled: boolean): Promise<void> {
    await request(server)
      .patch('/api/v1/admin/config/bulk')
      .set('Cookie', adminCookie)
      .send({ entries: [{ key: 'feature_ratings_residences', value: String(enabled) }] })
      .expect(200);
  }

  describe('default behavior (toggle off)', () => {
    it('refuses a rating submitted against a residence', async () => {
      const event = await seedAttendedPastEvent(residence);

      await request(server)
        .post(`/api/v1/locations/${residence.id}/ratings`)
        .set('Cookie', memberCookie)
        .send(validRating(event.id))
        .expect(403);
    });

    it('still accepts a rating for a normal restaurant', async () => {
      const event = await seedAttendedPastEvent(restaurant);

      await request(server)
        .post(`/api/v1/locations/${restaurant.id}/ratings`)
        .set('Cookie', memberCookie)
        .send(validRating(event.id))
        .expect(201);
    });

    it('offers no rateable events on the residence itself', async () => {
      await seedAttendedPastEvent(residence);

      const res = await request(server)
        .get(`/api/v1/locations/${residence.id}/ratings`)
        .set('Cookie', memberCookie)
        .expect(200);

      expect(res.body.eligibleEvents ?? []).toHaveLength(0);
    });

    it('keeps the residence out of the member rating queue while leaving the restaurant in it', async () => {
      await seedAttendedPastEvent(residence);
      await seedAttendedPastEvent(restaurant);

      const res = await request(server)
        .get('/api/v1/locations/rating-queue')
        .set('Cookie', memberCookie)
        .expect(200);

      const ids = (res.body as Array<{ locationId: number }>).map((r) => r.locationId);
      expect(ids).toContain(restaurant.id);
      expect(ids).not.toContain(residence.id);
    });
  });

  describe('toggle back on (still admin-overridable per instance)', () => {
    it('accepts a residence rating once an admin re-enables it', async () => {
      const event = await seedAttendedPastEvent(residence);
      await setResidenceRatings(true);

      await request(server)
        .post(`/api/v1/locations/${residence.id}/ratings`)
        .set('Cookie', memberCookie)
        .send(validRating(event.id))
        .expect(201);
    });
  });
});
