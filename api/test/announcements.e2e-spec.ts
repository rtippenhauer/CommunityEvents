import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City } from '@prisma/client';
import { UserRole } from '../src/database/enums';

describe('Announcements CRUD (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
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
    city = await seedCity(prisma);

    const admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const moderator = await seedUser(prisma, city.id, { role: UserRole.MODERATOR, email: 'mod@example.test' });
    const member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    moderatorCookie = await loginAs(app, moderator);
    memberCookie = await loginAs(app, member);
  });

  function validAnnouncementPayload(overrides: Record<string, unknown> = {}) {
    return {
      title: 'Cincinnati Chapter Update',
      body: 'Great news, everyone!',
      ...overrides,
    };
  }

  describe('POST /admin/announcements (create)', () => {
    it('creates an announcement when authenticated as admin', async () => {
      const res = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(201);

      expect(res.body).toMatchObject({ title: 'Cincinnati Chapter Update', status: 'draft' });
      expect(res.body.id).toEqual(expect.any(Number));
    });

    it('creates an announcement when authenticated as moderator', async () => {
      await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', moderatorCookie)
        .send(validAnnouncementPayload())
        .expect(201);
    });

    it('rejects a payload missing required fields', async () => {
      const res = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send({ title: 'No body here' })
        .expect(400);

      expect(res.body.message).toEqual(expect.any(Array));
    });

    it('rejects a title that is too short', async () => {
      await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload({ title: 'Hi' }))
        .expect(400);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).post('/api/v1/admin/announcements').send(validAnnouncementPayload()).expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', memberCookie)
        .send(validAnnouncementPayload())
        .expect(403);
    });
  });

  describe('GET /admin/announcements (read list) and GET /admin/announcements/:id (read one)', () => {
    it('lists created announcements', async () => {
      const created = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(201);

      const res = await request(server)
        .get('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.some((a: { id: number }) => a.id === created.body.id)).toBe(true);
    });

    it('reads a single announcement by id', async () => {
      const created = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(201);

      const res = await request(server)
        .get(`/api/v1/admin/announcements/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.title).toBe('Cincinnati Chapter Update');
    });

    it('returns 404 for a nonexistent announcement', async () => {
      await request(server)
        .get('/api/v1/admin/announcements/999999')
        .set('Cookie', adminCookie)
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/admin/announcements').expect(401);
    });
  });

  describe('PATCH /admin/announcements/:id (update)', () => {
    it('updates an announcement when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/announcements/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload({ title: 'Updated Title' }))
        .expect(200);

      const fetched = await request(server)
        .get(`/api/v1/admin/announcements/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(fetched.body.title).toBe('Updated Title');
    });

    it('rejects a payload missing required fields (body is required even on update)', async () => {
      const created = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/announcements/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ title: 'Only a title' })
        .expect(400);
    });

    it('returns 404 for a nonexistent announcement', async () => {
      await request(server)
        .patch('/api/v1/admin/announcements/999999')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      const created = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/announcements/${created.body.id}`)
        .send(validAnnouncementPayload({ title: 'Nope' }))
        .expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      const created = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(201);

      await request(server)
        .patch(`/api/v1/admin/announcements/${created.body.id}`)
        .set('Cookie', memberCookie)
        .send(validAnnouncementPayload({ title: 'Nope' }))
        .expect(403);
    });
  });

  describe('POST /admin/announcements/:id/publish', () => {
    it('publishes a draft announcement when authenticated as moderator', async () => {
      const created = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(201);

      await request(server)
        .post(`/api/v1/admin/announcements/${created.body.id}/publish`)
        .set('Cookie', moderatorCookie)
        .expect(201);

      const fetched = await request(server)
        .get(`/api/v1/admin/announcements/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(fetched.body.status).toBe('published');
    });
  });

  describe('DELETE /admin/announcements/:id', () => {
    it('deletes an announcement when authenticated as admin', async () => {
      const created = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(201);

      await request(server)
        .delete(`/api/v1/admin/announcements/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(204);

      await request(server)
        .get(`/api/v1/admin/announcements/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(404);
    });

    it('deletes an announcement when authenticated as moderator', async () => {
      const created = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(201);

      await request(server)
        .delete(`/api/v1/admin/announcements/${created.body.id}`)
        .set('Cookie', moderatorCookie)
        .expect(204);
    });

    it('returns 404 for a nonexistent announcement', async () => {
      await request(server)
        .delete('/api/v1/admin/announcements/999999')
        .set('Cookie', adminCookie)
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      const created = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(201);

      await request(server).delete(`/api/v1/admin/announcements/${created.body.id}`).expect(401);
    });

    it('rejects requests from a member (insufficient role)', async () => {
      const created = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(201);

      await request(server)
        .delete(`/api/v1/admin/announcements/${created.body.id}`)
        .set('Cookie', memberCookie)
        .expect(403);
    });
  });
  describe('PATCH /announcements/comments/:commentId (edit)', () => {
    // Publishes an announcement and drops a member comment on it, returning
    // the comment id — comments are only reachable on published announcements.
    async function seedComment(cookie: string, body = 'Original comment') {
      const created = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send(validAnnouncementPayload())
        .expect(201);
      await request(server)
        .post(`/api/v1/admin/announcements/${created.body.id}/publish`)
        .set('Cookie', adminCookie)
        .expect(201);

      const comment = await request(server)
        .post(`/api/v1/announcements/${created.body.id}/comments`)
        .set('Cookie', cookie)
        .send({ body })
        .expect(201);
      return { announcementId: created.body.id, comment: comment.body };
    }

    it('edits your own comment and stamps editedAt', async () => {
      const { announcementId, comment } = await seedComment(memberCookie);
      expect(comment.editedAt ?? null).toBeNull();

      const res = await request(server)
        .patch(`/api/v1/announcements/comments/${comment.id}`)
        .set('Cookie', memberCookie)
        .send({ body: 'Revised comment' })
        .expect(200);
      expect(res.body.body).toBe('Revised comment');
      expect(res.body.editedAt).not.toBeNull();

      const fetched = await request(server)
        .get(`/api/v1/announcements/${announcementId}`)
        .set('Cookie', memberCookie)
        .expect(200);
      const found = fetched.body.comments.find((c: { id: number }) => c.id === comment.id);
      expect(found.body).toBe('Revised comment');
      expect(found.editedAt).not.toBeNull();
    });

    // Deliberately unlike DELETE, which moderators may perform on any comment:
    // editing leaves the original author's name on words they did not write.
    it('rejects a moderator editing another member\'s comment', async () => {
      const { comment } = await seedComment(memberCookie);

      await request(server)
        .patch(`/api/v1/announcements/comments/${comment.id}`)
        .set('Cookie', moderatorCookie)
        .send({ body: 'Moderator rewrite' })
        .expect(403);
    });

    it('returns 404 for a nonexistent comment', async () => {
      await request(server)
        .patch('/api/v1/announcements/comments/999999')
        .set('Cookie', memberCookie)
        .send({ body: 'Nope' })
        .expect(404);
    });

    it('rejects an empty body', async () => {
      const { comment } = await seedComment(memberCookie);

      await request(server)
        .patch(`/api/v1/announcements/comments/${comment.id}`)
        .set('Cookie', memberCookie)
        .send({ body: '' })
        .expect(400);
    });

    it('rejects unauthenticated requests', async () => {
      const { comment } = await seedComment(memberCookie);

      await request(server)
        .patch(`/api/v1/announcements/comments/${comment.id}`)
        .send({ body: 'Anon edit' })
        .expect(401);
    });
  });
});
