import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { UserRole } from '../src/database/enums';

describe('Cities CRUD (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let adminCookie: string;
  let moderatorCookie: string;
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
    const homeCity = await seedCity(prisma);

    const admin = await seedUser(prisma, homeCity.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const moderator = await seedUser(prisma, homeCity.id, { role: UserRole.MODERATOR, email: 'mod@example.test' });
    const member = await seedUser(prisma, homeCity.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    moderatorCookie = await loginAs(app, moderator);
    memberCookie = await loginAs(app, member);
  });

  function validCityPayload(overrides: Record<string, unknown> = {}) {
    return {
      name: 'Louisville',
      subdomain: 'louisville',
      ...overrides,
    };
  }

  describe('POST /admin/cities (create)', () => {
    it('creates a city when authenticated as admin', async () => {
      const res = await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send(validCityPayload())
        .expect(201);

      expect(res.body).toMatchObject({ name: 'Louisville', subdomain: 'louisville' });
      expect(res.body.id).toEqual(expect.any(Number));
    });

    it('rejects a payload missing required fields', async () => {
      const res = await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send({ name: 'No subdomain here' })
        .expect(400);

      expect(res.body.message).toEqual(expect.any(Array));
    });

    it('rejects a subdomain with invalid characters', async () => {
      await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send(validCityPayload({ subdomain: 'Not Valid!' }))
        .expect(400);
    });

    it('rejects a duplicate subdomain', async () => {
      await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send(validCityPayload())
        .expect(201);

      await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send(validCityPayload({ name: 'Louisville Again' }))
        .expect(409);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).post('/api/v1/admin/cities').send(validCityPayload()).expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', memberCookie)
        .send(validCityPayload())
        .expect(403);
    });

    it('rejects requests from a moderator (admin-only)', async () => {
      await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', moderatorCookie)
        .send(validCityPayload())
        .expect(403);
    });
  });

  describe('GET /admin/cities (read list)', () => {
    it('lists created cities', async () => {
      const created = await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send(validCityPayload())
        .expect(201);

      const res = await request(server).get('/api/v1/admin/cities').set('Cookie', adminCookie).expect(200);
      expect(res.body.some((c: { id: number }) => c.id === created.body.id)).toBe(true);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/admin/cities').expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server).get('/api/v1/admin/cities').set('Cookie', memberCookie).expect(403);
    });
  });

  describe('PATCH /admin/cities/:id (update)', () => {
    it('updates a city when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send(validCityPayload())
        .expect(201);

      const res = await request(server)
        .patch(`/api/v1/admin/cities/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ name: 'Louisville Metro' })
        .expect(200);
      expect(res.body.name).toBe('Louisville Metro');
    });

    it('rejects a subdomain that collides with another city', async () => {
      await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send(validCityPayload())
        .expect(201);

      const second = await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send(validCityPayload({ name: 'Lexington', subdomain: 'lexington' }))
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/cities/${second.body.id}`)
        .set('Cookie', adminCookie)
        .send({ subdomain: 'louisville' })
        .expect(409);
    });

    it('rejects an invalid subdomain format', async () => {
      const created = await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send(validCityPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/cities/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ subdomain: 'Not Valid!' })
        .expect(400);
    });

    it('returns 404 for a nonexistent city', async () => {
      await request(server)
        .patch('/api/v1/admin/cities/999999')
        .set('Cookie', adminCookie)
        .send({ name: 'Nope' })
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      const created = await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send(validCityPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/cities/${created.body.id}`)
        .send({ name: 'Nope' })
        .expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      const created = await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send(validCityPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/cities/${created.body.id}`)
        .set('Cookie', memberCookie)
        .send({ name: 'Nope' })
        .expect(403);
    });

    it('rejects requests from a moderator (admin-only)', async () => {
      const created = await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send(validCityPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/cities/${created.body.id}`)
        .set('Cookie', moderatorCookie)
        .send({ name: 'Nope' })
        .expect(403);
    });
  });
});
