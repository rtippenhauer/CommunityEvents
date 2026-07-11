import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { UserRole } from '../src/database/entities/user.entity';

describe('Achievements CRUD (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];

  let adminCookie: string;
  let moderatorCookie: string;
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
    const city = await seedCity(dataSource);

    const admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const moderator = await seedUser(dataSource, city.id, { role: UserRole.MODERATOR, email: 'mod@example.test' });
    const member = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    moderatorCookie = await loginAs(app, moderator);
    memberCookie = await loginAs(app, member);
  });

  function validAchievementPayload(overrides: Record<string, unknown> = {}) {
    return {
      key: 'test_achievement',
      name: 'Test Achievement',
      description: 'Earned by doing a test thing.',
      icon: 'emoji_events',
      progressType: 'login',
      progressTarget: 5,
      points: 10,
      ...overrides,
    };
  }

  describe('POST /admin/achievements (create)', () => {
    it('creates an achievement when authenticated as admin', async () => {
      const res = await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .send(validAchievementPayload())
        .expect(201);

      expect(res.body).toMatchObject({ key: 'test_achievement', name: 'Test Achievement' });
    });

    it('rejects a payload missing required fields', async () => {
      await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .send({ key: 'incomplete' })
        .expect(400);
    });

    it('rejects a duplicate key', async () => {
      await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .send(validAchievementPayload())
        .expect(201);

      await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .send(validAchievementPayload({ name: 'Duplicate Key Achievement' }))
        .expect(409);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server)
        .post('/api/v1/admin/achievements')
        .send(validAchievementPayload())
        .expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', memberCookie)
        .send(validAchievementPayload())
        .expect(403);
    });

    it('rejects requests from a moderator (admin-only)', async () => {
      await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', moderatorCookie)
        .send(validAchievementPayload())
        .expect(403);
    });
  });

  describe('GET /admin/achievements (read list)', () => {
    it('lists created achievements', async () => {
      await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .send(validAchievementPayload())
        .expect(201);

      const res = await request(server)
        .get('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.some((a: { key: string }) => a.key === 'test_achievement')).toBe(true);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/admin/achievements').expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server).get('/api/v1/admin/achievements').set('Cookie', memberCookie).expect(403);
    });
  });

  describe('PATCH /admin/achievements/:id (update)', () => {
    it('updates an achievement when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .send(validAchievementPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/achievements/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ name: 'Updated Name', description: 'Updated description', points: 20, isSecret: false })
        .expect(200);

      const res = await request(server)
        .get('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .expect(200);
      const updated = res.body.find((a: { id: number }) => a.id === created.body.id);
      expect(updated).toMatchObject({ name: 'Updated Name', points: 20 });
    });

    it('rejects a payload missing required fields', async () => {
      const created = await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .send(validAchievementPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/achievements/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ points: 20, isSecret: false })
        .expect(400);
    });

    it('rejects unauthenticated requests', async () => {
      const created = await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .send(validAchievementPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/achievements/${created.body.id}`)
        .send({ name: 'Nope', description: 'Nope', points: 1, isSecret: false })
        .expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      const created = await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .send(validAchievementPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/achievements/${created.body.id}`)
        .set('Cookie', memberCookie)
        .send({ name: 'Nope', description: 'Nope', points: 1, isSecret: false })
        .expect(403);
    });
  });
});
