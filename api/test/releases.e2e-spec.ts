import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { UserRole } from '../src/database/enums';

describe('Releases CRUD (e2e)', () => {
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
    const city = await seedCity(prisma);

    const admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const moderator = await seedUser(prisma, city.id, { role: UserRole.MODERATOR, email: 'mod@example.test' });
    const member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    moderatorCookie = await loginAs(app, moderator);
    memberCookie = await loginAs(app, member);
  });

  function validReleasePayload(overrides: Record<string, unknown> = {}) {
    return {
      version: '1.0.0',
      title: 'First Release',
      body: 'This is the changelog body for the release.',
      ...overrides,
    };
  }

  describe('POST /admin/releases (create)', () => {
    it('creates a release when authenticated as admin', async () => {
      const res = await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload())
        .expect(201);

      expect(res.body).toMatchObject({ version: '1.0.0', title: 'First Release' });
      expect(res.body.id).toEqual(expect.any(Number));
    });

    it('rejects a payload missing required fields', async () => {
      const res = await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send({ version: '1.0.0' })
        .expect(400);

      expect(res.body.message).toEqual(expect.any(Array));
    });

    it('rejects an invalid (non-semver) version', async () => {
      await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload({ version: 'not-semver' }))
        .expect(400);
    });

    it('rejects a duplicate version', async () => {
      await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload())
        .expect(201);

      await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload({ title: 'Duplicate Version Release' }))
        .expect(409);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).post('/api/v1/admin/releases').send(validReleasePayload()).expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', memberCookie)
        .send(validReleasePayload())
        .expect(403);
    });

    it('rejects requests from a moderator (not admin/automation)', async () => {
      await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', moderatorCookie)
        .send(validReleasePayload())
        .expect(403);
    });
  });

  describe('GET /admin/releases (read list) and GET /admin/releases/:id (read one)', () => {
    it('lists created releases', async () => {
      const created = await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload())
        .expect(201);

      const res = await request(server).get('/api/v1/admin/releases').set('Cookie', adminCookie).expect(200);
      expect(res.body.some((r: { id: number }) => r.id === created.body.id)).toBe(true);
    });

    it('reads a single release by id', async () => {
      const created = await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload())
        .expect(201);

      const res = await request(server)
        .get(`/api/v1/admin/releases/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.title).toBe('First Release');
    });

    it('returns 404 for a nonexistent release', async () => {
      await request(server).get('/api/v1/admin/releases/999999').set('Cookie', adminCookie).expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/admin/releases').expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server).get('/api/v1/admin/releases').set('Cookie', memberCookie).expect(403);
    });
  });

  describe('PATCH /admin/releases/:id (update)', () => {
    it('updates a release when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload())
        .expect(201);

      const res = await request(server)
        .patch(`/api/v1/admin/releases/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ title: 'Updated Release Title' })
        .expect(200);
      expect(res.body.title).toBe('Updated Release Title');
    });

    it('rejects editing a published release', async () => {
      const created = await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload())
        .expect(201);

      await request(server)
        .post(`/api/v1/admin/releases/${created.body.id}/publish`)
        .set('Cookie', adminCookie)
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/releases/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ title: 'Should not be allowed' })
        .expect(400);
    });

    it('rejects a version that collides with another release', async () => {
      await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload())
        .expect(201);

      const second = await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload({ version: '1.1.0', title: 'Second Release' }))
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/releases/${second.body.id}`)
        .set('Cookie', adminCookie)
        .send({ version: '1.0.0' })
        .expect(409);
    });

    it('returns 404 for a nonexistent release', async () => {
      await request(server)
        .patch('/api/v1/admin/releases/999999')
        .set('Cookie', adminCookie)
        .send({ title: 'Nope' })
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      const created = await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/releases/${created.body.id}`)
        .send({ title: 'Nope' })
        .expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      const created = await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/releases/${created.body.id}`)
        .set('Cookie', memberCookie)
        .send({ title: 'Nope' })
        .expect(403);
    });
  });

  describe('POST /admin/releases/:id/publish and /unpublish', () => {
    it('publishes a draft release when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload())
        .expect(201);

      const res = await request(server)
        .post(`/api/v1/admin/releases/${created.body.id}/publish`)
        .set('Cookie', adminCookie)
        .expect(201);
      expect(res.body.publishedAt).not.toBeNull();
    });

    it('unpublishes a published release when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload())
        .expect(201);

      await request(server)
        .post(`/api/v1/admin/releases/${created.body.id}/publish`)
        .set('Cookie', adminCookie)
        .expect(201);

      const res = await request(server)
        .post(`/api/v1/admin/releases/${created.body.id}/unpublish`)
        .set('Cookie', adminCookie)
        .expect(201);
      expect(res.body.publishedAt).toBeNull();
    });

    it('rejects publish requests from a member (insufficient role)', async () => {
      const created = await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload())
        .expect(201);

      await request(server)
        .post(`/api/v1/admin/releases/${created.body.id}/publish`)
        .set('Cookie', memberCookie)
        .expect(403);
    });

    it('rejects unauthenticated publish requests', async () => {
      const created = await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send(validReleasePayload())
        .expect(201);

      await request(server).post(`/api/v1/admin/releases/${created.body.id}/publish`).expect(401);
    });
  });
});
