import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { CityEntity } from '../src/database/entities/city.entity';
import { LocationEntity } from '../src/database/entities/location.entity';
import { UserRole } from '../src/database/entities/user.entity';

describe('Events CRUD (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];

  let city: CityEntity;
  let location: LocationEntity;
  let adminCookie: string;
  let memberCookie: string;

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
    location = await seedLocation(dataSource, city.id);

    const admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const member = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
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
