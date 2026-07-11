import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { UserRole } from '../src/database/entities/user.entity';

// 1x1 transparent PNG, valid enough to pass the mimetype/extension filter.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

describe('Custom Icons CRUD (e2e)', () => {
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

  describe('POST /admin/custom-icons (create)', () => {
    it('creates an icon when authenticated as admin', async () => {
      const res = await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .field('name', 'Party Hat')
        .attach('image', TINY_PNG, 'party-hat.png')
        .expect(201);

      expect(res.body).toMatchObject({ name: 'Party Hat', usageCount: 0 });
    });

    it('creates an icon when authenticated as moderator', async () => {
      await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', moderatorCookie)
        .field('name', 'Party Hat')
        .attach('image', TINY_PNG, 'party-hat.png')
        .expect(201);
    });

    it('rejects a request missing the name field', async () => {
      await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .attach('image', TINY_PNG, 'party-hat.png')
        .expect(400);
    });

    it('rejects a request with no image file', async () => {
      await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .field('name', 'Party Hat')
        .expect(400);
    });

    it('rejects a disallowed file type', async () => {
      await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .field('name', 'Party Hat')
        .attach('image', Buffer.from('not an image'), 'notes.txt')
        .expect(500);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server)
        .post('/api/v1/admin/custom-icons')
        .field('name', 'Party Hat')
        .attach('image', TINY_PNG, 'party-hat.png')
        .expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', memberCookie)
        .field('name', 'Party Hat')
        .attach('image', TINY_PNG, 'party-hat.png')
        .expect(403);
    });
  });

  describe('GET /admin/custom-icons (read list)', () => {
    it('lists created icons', async () => {
      await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .field('name', 'Party Hat')
        .attach('image', TINY_PNG, 'party-hat.png')
        .expect(201);

      const res = await request(server)
        .get('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.some((i: { name: string }) => i.name === 'Party Hat')).toBe(true);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/admin/custom-icons').expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server).get('/api/v1/admin/custom-icons').set('Cookie', memberCookie).expect(403);
    });
  });

  describe('DELETE /admin/custom-icons/:id', () => {
    it('deletes an unused icon when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .field('name', 'Party Hat')
        .attach('image', TINY_PNG, 'party-hat.png')
        .expect(201);

      await request(server)
        .delete(`/api/v1/admin/custom-icons/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const res = await request(server)
        .get('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.some((i: { id: number }) => i.id === created.body.id)).toBe(false);
    });

    it('refuses to delete an icon still used by an achievement', async () => {
      const created = await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .field('name', 'Party Hat')
        .attach('image', TINY_PNG, 'party-hat.png')
        .expect(201);

      await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .send({
          key: 'uses_custom_icon',
          name: 'Uses Custom Icon',
          description: 'References the custom icon.',
          icon: `img:${created.body.imagePath}`,
          progressType: 'login',
          progressTarget: 1,
          points: 5,
        })
        .expect(201);

      await request(server)
        .delete(`/api/v1/admin/custom-icons/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(409);
    });

    it('returns 404 for a nonexistent icon', async () => {
      await request(server)
        .delete('/api/v1/admin/custom-icons/999999')
        .set('Cookie', adminCookie)
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      const created = await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .field('name', 'Party Hat')
        .attach('image', TINY_PNG, 'party-hat.png')
        .expect(201);

      await request(server).delete(`/api/v1/admin/custom-icons/${created.body.id}`).expect(401);
    });

    it('rejects requests from a moderator (admin-only)', async () => {
      const created = await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .field('name', 'Party Hat')
        .attach('image', TINY_PNG, 'party-hat.png')
        .expect(201);

      await request(server)
        .delete(`/api/v1/admin/custom-icons/${created.body.id}`)
        .set('Cookie', moderatorCookie)
        .expect(403);
    });
  });
});
