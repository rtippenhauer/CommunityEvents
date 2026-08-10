import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { UserRole } from '../src/database/enums';

describe('Reports CRUD (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let adminCookie: string;
  let memberCookie: string;
  let authorCookie: string;
  let commentId: number;

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
    const location = await seedLocation(prisma, city.id);

    const admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    const author = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'author@example.test' });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
    authorCookie = await loginAs(app, author);

    const event = await request(server)
      .post('/api/v1/events')
      .set('Cookie', adminCookie)
      .send({
        cityId: city.id,
        locationId: location.id,
        title: 'Report Test Dinner',
        eventDate: '2027-03-01',
        eventTime: '18:00',
      })
      .expect(201);

    const comment = await request(server)
      .post(`/api/v1/events/${event.body.id}/comments`)
      .set('Cookie', authorCookie)
      .send({ body: 'A comment someone might report' })
      .expect(201);
    commentId = comment.body.id;
  });

  function validReportPayload(overrides: Record<string, unknown> = {}) {
    return {
      contentType: 'event_comment',
      contentId: commentId,
      reason: 'This is spam',
      ...overrides,
    };
  }

  describe('POST /reports (create)', () => {
    it('creates a report when authenticated as a member', async () => {
      await request(server)
        .post('/api/v1/reports')
        .set('Cookie', memberCookie)
        .send(validReportPayload())
        .expect(201);
    });

    it('rejects a payload missing required fields', async () => {
      await request(server)
        .post('/api/v1/reports')
        .set('Cookie', memberCookie)
        .send({ reason: 'Missing contentType and contentId' })
        .expect(400);
    });

    it('rejects an invalid contentType', async () => {
      await request(server)
        .post('/api/v1/reports')
        .set('Cookie', memberCookie)
        .send(validReportPayload({ contentType: 'not-a-real-type' }))
        .expect(400);
    });

    it('rejects reporting your own content', async () => {
      await request(server)
        .post('/api/v1/reports')
        .set('Cookie', authorCookie)
        .send(validReportPayload())
        .expect(403);
    });

    it('rejects a duplicate report of the same content by the same user', async () => {
      await request(server).post('/api/v1/reports').set('Cookie', memberCookie).send(validReportPayload()).expect(201);

      await request(server)
        .post('/api/v1/reports')
        .set('Cookie', memberCookie)
        .send(validReportPayload())
        .expect(409);
    });

    it('returns 404 for nonexistent content', async () => {
      await request(server)
        .post('/api/v1/reports')
        .set('Cookie', memberCookie)
        .send(validReportPayload({ contentId: 999999 }))
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).post('/api/v1/reports').send(validReportPayload()).expect(401);
    });
  });

  describe('GET /admin/reports (read list)', () => {
    it('lists reports when authenticated as admin', async () => {
      await request(server).post('/api/v1/reports').set('Cookie', memberCookie).send(validReportPayload()).expect(201);

      const res = await request(server).get('/api/v1/admin/reports').set('Cookie', adminCookie).expect(200);
      expect(res.body.some((r: { contentId: number }) => r.contentId === commentId)).toBe(true);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/admin/reports').expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server).get('/api/v1/admin/reports').set('Cookie', memberCookie).expect(403);
    });
  });

  describe('PATCH /admin/reports/:id (review)', () => {
    it('dismisses a report when authenticated as admin', async () => {
      await request(server)
        .post('/api/v1/reports')
        .set('Cookie', memberCookie)
        .send(validReportPayload())
        .expect(201);

      const res = await request(server).get('/api/v1/admin/reports').set('Cookie', adminCookie).expect(200);
      const report = res.body.find((r: { contentId: number }) => r.contentId === commentId);

      await request(server)
        .patch(`/api/v1/admin/reports/${report.id}`)
        .set('Cookie', adminCookie)
        .send({ action: 'dismiss' })
        .expect(200);
    });

    it('deletes the content and dismisses when action is delete_and_dismiss', async () => {
      await request(server).post('/api/v1/reports').set('Cookie', memberCookie).send(validReportPayload()).expect(201);
      const res = await request(server).get('/api/v1/admin/reports').set('Cookie', adminCookie).expect(200);
      const report = res.body.find((r: { contentId: number }) => r.contentId === commentId);

      await request(server)
        .patch(`/api/v1/admin/reports/${report.id}`)
        .set('Cookie', adminCookie)
        .send({ action: 'delete_and_dismiss' })
        .expect(200);
    });

    it('rejects reviewing an already-reviewed report', async () => {
      await request(server).post('/api/v1/reports').set('Cookie', memberCookie).send(validReportPayload()).expect(201);
      const res = await request(server).get('/api/v1/admin/reports').set('Cookie', adminCookie).expect(200);
      const report = res.body.find((r: { contentId: number }) => r.contentId === commentId);

      await request(server)
        .patch(`/api/v1/admin/reports/${report.id}`)
        .set('Cookie', adminCookie)
        .send({ action: 'dismiss' })
        .expect(200);

      await request(server)
        .patch(`/api/v1/admin/reports/${report.id}`)
        .set('Cookie', adminCookie)
        .send({ action: 'dismiss' })
        .expect(409);
    });

    it('rejects an invalid action value', async () => {
      await request(server).post('/api/v1/reports').set('Cookie', memberCookie).send(validReportPayload()).expect(201);
      const res = await request(server).get('/api/v1/admin/reports').set('Cookie', adminCookie).expect(200);
      const report = res.body.find((r: { contentId: number }) => r.contentId === commentId);

      await request(server)
        .patch(`/api/v1/admin/reports/${report.id}`)
        .set('Cookie', adminCookie)
        .send({ action: 'not-a-real-action' })
        .expect(400);
    });

    it('returns 404 for a nonexistent report', async () => {
      await request(server)
        .patch('/api/v1/admin/reports/999999')
        .set('Cookie', adminCookie)
        .send({ action: 'dismiss' })
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server)
        .patch('/api/v1/admin/reports/999999')
        .send({ action: 'dismiss' })
        .expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server)
        .patch('/api/v1/admin/reports/999999')
        .set('Cookie', memberCookie)
        .send({ action: 'dismiss' })
        .expect(403);
    });
  });
});
