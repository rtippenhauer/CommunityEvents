import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { UserRole } from '../src/database/entities/user.entity';

describe('Feedback CRUD (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];

  let adminCookie: string;
  let memberCookie: string;
  let nonValidatedCookie: string;

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
    const member = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    const nonValidated = await seedUser(dataSource, city.id, {
      role: UserRole.NON_VALIDATED,
      email: 'nonvalidated@example.test',
    });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
    nonValidatedCookie = await loginAs(app, nonValidated);
  });

  function validFeedbackPayload(overrides: Record<string, unknown> = {}) {
    return {
      category: 'bug',
      title: 'The merch page is broken',
      body: 'Clicking the store link does nothing on mobile Safari.',
      ...overrides,
    };
  }

  describe('POST /feedback (create)', () => {
    it('creates a feedback ticket when authenticated as a member', async () => {
      const res = await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send(validFeedbackPayload())
        .expect(201);

      expect(res.body).toMatchObject({ title: 'The merch page is broken', status: 'open' });
    });

    it('rejects a payload missing required fields', async () => {
      await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send({ title: 'No body or category' })
        .expect(400);
    });

    it('rejects an invalid category', async () => {
      await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send(validFeedbackPayload({ category: 'not-a-real-category' }))
        .expect(400);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).post('/api/v1/feedback').send(validFeedbackPayload()).expect(401);
    });

    it('rejects requests from a non-validated member', async () => {
      await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', nonValidatedCookie)
        .send(validFeedbackPayload())
        .expect(403);
    });
  });

  describe('GET /admin/feedback (read list)', () => {
    it('lists feedback tickets when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send(validFeedbackPayload())
        .expect(201);

      const res = await request(server).get('/api/v1/admin/feedback').set('Cookie', adminCookie).expect(200);
      expect(res.body.some((f: { id: number }) => f.id === created.body.id)).toBe(true);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/admin/feedback').expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server).get('/api/v1/admin/feedback').set('Cookie', memberCookie).expect(403);
    });
  });

  describe('PATCH /admin/feedback/:id (update status)', () => {
    it('updates a ticket\'s status when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send(validFeedbackPayload())
        .expect(201);

      const res = await request(server)
        .patch(`/api/v1/admin/feedback/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ status: 'in_progress' })
        .expect(200);
      expect(res.body.status).toBe('in_progress');
    });

    it('rejects an invalid status value', async () => {
      const created = await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send(validFeedbackPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/feedback/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ status: 'not-a-real-status' })
        .expect(400);
    });

    it('returns 404 for a nonexistent ticket', async () => {
      await request(server)
        .patch('/api/v1/admin/feedback/999999')
        .set('Cookie', adminCookie)
        .send({ status: 'in_progress' })
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      const created = await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send(validFeedbackPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/feedback/${created.body.id}`)
        .send({ status: 'in_progress' })
        .expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      const created = await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send(validFeedbackPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/feedback/${created.body.id}`)
        .set('Cookie', memberCookie)
        .send({ status: 'in_progress' })
        .expect(403);
    });
  });

  describe('POST /admin/feedback/:id/notes', () => {
    it('adds an admin note when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send(validFeedbackPayload())
        .expect(201);

      const res = await request(server)
        .post(`/api/v1/admin/feedback/${created.body.id}/notes`)
        .set('Cookie', adminCookie)
        .send({ content: 'Investigating now.' })
        .expect(201);
      expect(res.body).toMatchObject({ content: 'Investigating now.' });
    });

    it('rejects a payload missing content', async () => {
      const created = await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send(validFeedbackPayload())
        .expect(201);

      await request(server)
        .post(`/api/v1/admin/feedback/${created.body.id}/notes`)
        .set('Cookie', adminCookie)
        .send({})
        .expect(400);
    });

    it('returns 404 for a nonexistent ticket', async () => {
      await request(server)
        .post('/api/v1/admin/feedback/999999/notes')
        .set('Cookie', adminCookie)
        .send({ content: 'Hello?' })
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      const created = await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send(validFeedbackPayload())
        .expect(201);

      await request(server)
        .post(`/api/v1/admin/feedback/${created.body.id}/notes`)
        .send({ content: 'Hello?' })
        .expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      const created = await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send(validFeedbackPayload())
        .expect(201);

      await request(server)
        .post(`/api/v1/admin/feedback/${created.body.id}/notes`)
        .set('Cookie', memberCookie)
        .send({ content: 'Hello?' })
        .expect(403);
    });
  });
});
