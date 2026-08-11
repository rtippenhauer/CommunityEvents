import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City, locations as Location } from '@prisma/client';
import { UserRole } from '../src/database/enums';

describe('Events CRUD (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
  let location: Location;
  let adminCookie: string;
  let memberCookie: string;

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

    const admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
  });

  function validEventPayload(overrides: Record<string, unknown> = {}) {
    return {
      cityId: city.id,
      locationId: location.id,
      title: 'Tuesday Dinner',
      eventDate: '2027-01-05',
      eventTime: '18:30',
      ...overrides,
    };
  }

  // Regression (v2-1 -> caught on stage during v2-2): event_date is a DATE
  // column and event_time a TIME column, and the API has always published them
  // as 'YYYY-MM-DD' and 'HH:MM:SS'. Prisma returns both as Date objects, and
  // the list/detail endpoints were handing those straight back, so the wire
  // format silently became "2026-08-11T00:00:00.000Z" / "1970-01-01T18:30:00.000Z".
  //
  // The client's eventTime.substring(0, 5) then produced "1970-", and a DATE
  // read as UTC midnight rendered as the *previous day* anywhere west of
  // Greenwich -- a Tuesday event displayed as Monday in Eastern.
  //
  // Nothing failed: the whole suite passed while the format was wrong, because
  // no test asserted the shape of these two fields. These do.
  describe('eventDate/eventTime wire format', () => {
    const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
    const TIME_ONLY = /^\d{2}:\d{2}:\d{2}$/;

    it('publishes date-only and time-only strings from the list endpoint', async () => {
      await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload())
        .expect(201);

      const res = await request(server).get('/api/v1/events').set('Cookie', adminCookie).expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      for (const event of res.body) {
        expect(event.eventDate).toMatch(DATE_ONLY);
        expect(event.eventTime).toMatch(TIME_ONLY);
      }
    });

    it('publishes date-only and time-only strings from the detail endpoint', async () => {
      const created = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload())
        .expect(201);

      const res = await request(server)
        .get(`/api/v1/events/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.eventDate).toMatch(DATE_ONLY);
      expect(res.body.eventTime).toMatch(TIME_ONLY);
    });

    it('round-trips the exact date it was given, with no timezone drift', async () => {
      const created = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload({ eventDate: '2027-01-05', eventTime: '18:30' }))
        .expect(201);

      const res = await request(server)
        .get(`/api/v1/events/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(200);

      expect(res.body.eventDate).toBe('2027-01-05');
      expect(res.body.eventTime).toBe('18:30:00');
    });
  });

  describe('POST /events (create)', () => {
    it('creates an event when authenticated as admin', async () => {
      const res = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload())
        .expect(201);

      expect(res.body).toMatchObject({
        title: 'Tuesday Dinner',
        cityId: city.id,
        locationId: location.id,
        status: 'draft',
      });
      expect(res.body.id).toEqual(expect.any(Number));
    });

    it('rejects a payload missing required fields', async () => {
      const res = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send({ cityId: city.id, locationId: location.id })
        .expect(400);

      expect(res.body.message).toEqual(expect.any(Array));
    });

    it('rejects an invalid status value', async () => {
      await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload({ status: 'not-a-real-status' }))
        .expect(400);
    });

    it('rejects a locationId that does not exist', async () => {
      await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload({ locationId: 999999 }))
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).post('/api/v1/events').send(validEventPayload()).expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server)
        .post('/api/v1/events')
        .set('Cookie', memberCookie)
        .send(validEventPayload())
        .expect(403);
    });
  });

  describe('GET /events (read list) and GET /events/:id (read one)', () => {
    it('lists created events', async () => {
      const created = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload())
        .expect(201);

      const res = await request(server)
        .get('/api/v1/events')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.some((e: { id: number }) => e.id === created.body.id)).toBe(true);
    });

    it('reads a single event by id', async () => {
      const created = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload())
        .expect(201);

      const res = await request(server).get(`/api/v1/events/${created.body.id}`).expect(200);
      expect(res.body.id).toBe(created.body.id);
      expect(res.body.title).toBe('Tuesday Dinner');
    });

    it('returns 404 for a nonexistent event', async () => {
      await request(server).get('/api/v1/events/999999').expect(404);
    });
  });

  describe('PATCH /events/:id (update status)', () => {
    it("updates an event's status when authenticated as admin", async () => {
      const created = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/events/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ status: 'published' })
        .expect(200);

      const fetched = await request(server).get(`/api/v1/events/${created.body.id}`).expect(200);
      expect(fetched.body.status).toBe('published');
    });

    it('rejects an invalid status value', async () => {
      const created = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/events/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ status: 'not-a-real-status' })
        .expect(400);
    });

    it('rejects unauthenticated requests', async () => {
      const created = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/events/${created.body.id}`)
        .send({ status: 'published' })
        .expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      const created = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/events/${created.body.id}`)
        .set('Cookie', memberCookie)
        .send({ status: 'published' })
        .expect(403);
    });
  });

  describe('DELETE /events/:id', () => {
    it('deletes a draft event when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload())
        .expect(201);

      await request(server)
        .delete(`/api/v1/events/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(200);

      await request(server).get(`/api/v1/events/${created.body.id}`).expect(404);
    });

    it('refuses to delete a published event', async () => {
      const created = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/events/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ status: 'published' })
        .expect(200);

      await request(server)
        .delete(`/api/v1/events/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(400);
    });

    it('rejects unauthenticated requests', async () => {
      const created = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload())
        .expect(201);

      await request(server).delete(`/api/v1/events/${created.body.id}`).expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      const created = await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send(validEventPayload())
        .expect(201);

      await request(server)
        .delete(`/api/v1/events/${created.body.id}`)
        .set('Cookie', memberCookie)
        .expect(403);
    });
  });
});
