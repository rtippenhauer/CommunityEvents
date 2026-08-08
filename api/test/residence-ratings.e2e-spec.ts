import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { UserEntity, UserRole } from '../src/database/entities/user.entity';
import { CityEntity } from '../src/database/entities/city.entity';
import { LocationEntity } from '../src/database/entities/location.entity';
import { EventEntity } from '../src/database/entities/event.entity';
import { EventRsvpEntity, RsvpStatus } from '../src/database/entities/event-rsvp.entity';

// Phase 37: residences are not rateable. The mechanism is Phase 33's
// `feature_ratings_residences` toggle; what changed is that it now defaults
// OFF. These tests pin the default, since a silently flipped-back default
// would restore exactly the behavior this phase set out to remove.
describe('Residence ratings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];

  let city: CityEntity;
  let admin: UserEntity;
  let member: UserEntity;
  let memberCookie: string;
  let adminCookie: string;
  let residence: LocationEntity;
  let restaurant: LocationEntity;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(dataSource);
    city = await seedCity(dataSource);
    admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    member = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);

    residence = await seedLocation(dataSource, city.id, {
      name: "Someone's House",
      isResidence: true,
    });
    restaurant = await seedLocation(dataSource, city.id, { name: 'A Real Restaurant' });
  });

  // A rateable visit: a past event at `location` that `member` attended.
  // Seeded directly rather than through the API, since the events endpoint
  // won't accept a date in the past.
  async function seedAttendedPastEvent(location: LocationEntity): Promise<EventEntity> {
    const event = await dataSource.getRepository(EventEntity).save(
      dataSource.getRepository(EventEntity).create({
        cityId: city.id,
        locationId: location.id,
        locationName: location.name,
        locationAddress: location.address,
        createdById: admin.id,
        title: `Dinner at ${location.name}`,
        eventDate: '2020-01-05',
        eventTime: '18:30',
      }),
    );
    await dataSource.getRepository(EventRsvpEntity).save(
      dataSource.getRepository(EventRsvpEntity).create({
        eventId: event.id,
        userId: member.id,
        status: RsvpStatus.GOING,
        attended: true,
      }),
    );
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
