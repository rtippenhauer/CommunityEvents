import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City } from '@prisma/client';
import { UserRole } from '../src/database/enums';

describe('Locations CRUD (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
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

    const admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
  });

  function validLocationPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'The Test Bistro',
      address: '456 Sample Ave, Test City, OH 45202',
      cityId: city.id,
      ...overrides,
    };
  }

  describe('POST /locations (create)', () => {
    it('creates a location when authenticated as admin', async () => {
      const res = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send(validLocationPayload())
        .expect(201);

      expect(res.body).toMatchObject({ name: 'The Test Bistro', cityId: city.id });
      expect(res.body.id).toEqual(expect.any(Number));
    });

    it('rejects a payload missing required fields', async () => {
      const res = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send({ cityId: city.id })
        .expect(400);

      expect(res.body.message).toEqual(expect.any(Array));
    });

    it('rejects an invalid field value (malformed website URL)', async () => {
      await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send(validLocationPayload({ websiteUrl: 'not-a-url' }))
        .expect(400);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).post('/api/v1/locations').send(validLocationPayload()).expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server)
        .post('/api/v1/locations')
        .set('Cookie', memberCookie)
        .send(validLocationPayload())
        .expect(403);
    });
  });

  describe('GET /locations (read list) and GET /locations/:id (read one)', () => {
    it('lists created locations', async () => {
      const created = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send(validLocationPayload())
        .expect(201);

      const res = await request(server).get('/api/v1/locations').set('Cookie', memberCookie).expect(200);
      expect(res.body.some((r: { id: number }) => r.id === created.body.id)).toBe(true);
    });

    it('reads a single location by id', async () => {
      const created = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send(validLocationPayload())
        .expect(201);

      const res = await request(server)
        .get(`/api/v1/locations/${created.body.id}`)
        .set('Cookie', memberCookie)
        .expect(200);
      expect(res.body.name).toBe('The Test Bistro');
    });

    it('returns 404 for a nonexistent location', async () => {
      await request(server).get('/api/v1/locations/999999').set('Cookie', memberCookie).expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/locations').expect(401);
    });
  });

  describe('PATCH /locations/:id (update)', () => {
    it('updates a location when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send(validLocationPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/locations/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ name: 'The Updated Bistro' })
        .expect(200);

      const fetched = await request(server)
        .get(`/api/v1/locations/${created.body.id}`)
        .set('Cookie', memberCookie)
        .expect(200);
      expect(fetched.body.name).toBe('The Updated Bistro');
    });

    it('rejects unauthenticated requests', async () => {
      const created = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send(validLocationPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/locations/${created.body.id}`)
        .send({ name: 'Nope' })
        .expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      const created = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send(validLocationPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/locations/${created.body.id}`)
        .set('Cookie', memberCookie)
        .send({ name: 'Nope' })
        .expect(403);
    });
  });

  describe('DELETE /locations/:id (soft delete/status) and restore', () => {
    it('soft-deletes a location when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send(validLocationPayload())
        .expect(201);

      await request(server)
        .delete(`/api/v1/locations/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(200);

      await request(server)
        .get(`/api/v1/locations/${created.body.id}`)
        .set('Cookie', memberCookie)
        .expect(404);
    });

    it('restores a soft-deleted location when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send(validLocationPayload())
        .expect(201);

      await request(server)
        .delete(`/api/v1/locations/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(200);

      await request(server)
        .patch(`/api/v1/locations/${created.body.id}/restore`)
        .set('Cookie', adminCookie)
        .expect(200);

      await request(server)
        .get(`/api/v1/locations/${created.body.id}`)
        .set('Cookie', memberCookie)
        .expect(200);
    });

    it('rejects unauthenticated delete requests', async () => {
      const created = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send(validLocationPayload())
        .expect(201);

      await request(server).delete(`/api/v1/locations/${created.body.id}`).expect(401);
    });

    it('rejects delete requests from a member (insufficient role)', async () => {
      const created = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send(validLocationPayload())
        .expect(201);

      await request(server)
        .delete(`/api/v1/locations/${created.body.id}`)
        .set('Cookie', memberCookie)
        .expect(403);
    });

    it('rejects delete requests from a moderator (admin-only)', async () => {
      const moderator = await seedUser(prisma, city.id, {
        role: UserRole.MODERATOR,
        email: 'mod@example.test',
      });
      const moderatorCookie = await loginAs(app, moderator);

      const created = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send(validLocationPayload())
        .expect(201);

      await request(server)
        .delete(`/api/v1/locations/${created.body.id}`)
        .set('Cookie', moderatorCookie)
        .expect(403);
    });
  });
});
