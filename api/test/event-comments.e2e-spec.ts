import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { UserRole } from '../src/database/entities/user.entity';

describe('Event Comments CRUD (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];

  let adminCookie: string;
  let memberCookie: string;
  let otherMemberCookie: string;
  let nonValidatedCookie: string;
  let eventId: number;

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
    const location = await seedLocation(dataSource, city.id);

    const admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const member = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    const otherMember = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'other@example.test' });
    const nonValidated = await seedUser(dataSource, city.id, {
      role: UserRole.NON_VALIDATED,
      email: 'nonvalidated@example.test',
    });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
    otherMemberCookie = await loginAs(app, otherMember);
    nonValidatedCookie = await loginAs(app, nonValidated);

    const event = await request(server)
      .post('/api/v1/events')
      .set('Cookie', adminCookie)
      .send({
        cityId: city.id,
        locationId: location.id,
        title: 'Comment Test Dinner',
        eventDate: '2027-02-01',
        eventTime: '18:00',
      })
      .expect(201);
    eventId = event.body.id;
  });

  describe('POST /events/:eventId/comments (create)', () => {
    it('adds a comment when authenticated as a member', async () => {
      const res = await request(server)
        .post(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', memberCookie)
        .send({ body: 'Excited for this one!' })
        .expect(201);

      expect(res.body).toMatchObject({ body: 'Excited for this one!', deleted: false });
    });

    it('rejects a payload missing the body field', async () => {
      await request(server)
        .post(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', memberCookie)
        .send({})
        .expect(400);
    });

    it('returns 404 for a nonexistent event', async () => {
      await request(server)
        .post('/api/v1/events/999999/comments')
        .set('Cookie', memberCookie)
        .send({ body: 'Hello?' })
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server)
        .post(`/api/v1/events/${eventId}/comments`)
        .send({ body: 'Hello?' })
        .expect(401);
    });

    it('rejects requests from a non-validated member', async () => {
      await request(server)
        .post(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', nonValidatedCookie)
        .send({ body: 'Hello?' })
        .expect(403);
    });
  });

  describe('GET /events/:eventId/comments (read list)', () => {
    it('lists added comments', async () => {
      await request(server)
        .post(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', memberCookie)
        .send({ body: 'Excited for this one!' })
        .expect(201);

      const res = await request(server)
        .get(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', memberCookie)
        .expect(200);
      expect(res.body.some((c: { body: string }) => c.body === 'Excited for this one!')).toBe(true);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get(`/api/v1/events/${eventId}/comments`).expect(401);
    });
  });

  describe('PATCH /events/:eventId/comments/:commentId (edit)', () => {
    const create = (cookie: string, body = 'Original text') =>
      request(server)
        .post(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', cookie)
        .send({ body })
        .expect(201);

    it('edits your own comment and stamps editedAt', async () => {
      const created = await create(memberCookie);
      expect(created.body.editedAt).toBeNull();

      const res = await request(server)
        .patch(`/api/v1/events/${eventId}/comments/${created.body.id}`)
        .set('Cookie', memberCookie)
        .send({ body: 'Revised text' })
        .expect(200);

      expect(res.body.body).toBe('Revised text');
      expect(res.body.editedAt).not.toBeNull();

      const list = await request(server)
        .get(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', memberCookie)
        .expect(200);
      const found = list.body.find((c: { id: number }) => c.id === created.body.id);
      expect(found.body).toBe('Revised text');
      expect(found.editedAt).not.toBeNull();
    });

    it('rejects editing another member\'s comment', async () => {
      const created = await create(memberCookie);

      await request(server)
        .patch(`/api/v1/events/${eventId}/comments/${created.body.id}`)
        .set('Cookie', otherMemberCookie)
        .send({ body: 'Hijacked' })
        .expect(403);
    });

    // Deliberately unlike DELETE, which admins may perform on any comment:
    // editing leaves the original author's name on words they did not write.
    it('rejects an admin editing another member\'s comment', async () => {
      const created = await create(memberCookie);

      await request(server)
        .patch(`/api/v1/events/${eventId}/comments/${created.body.id}`)
        .set('Cookie', adminCookie)
        .send({ body: 'Moderator rewrite' })
        .expect(403);
    });

    it('returns 404 editing a deleted comment', async () => {
      const created = await create(memberCookie);
      await request(server)
        .delete(`/api/v1/events/${eventId}/comments/${created.body.id}`)
        .set('Cookie', memberCookie)
        .expect(200);

      await request(server)
        .patch(`/api/v1/events/${eventId}/comments/${created.body.id}`)
        .set('Cookie', memberCookie)
        .send({ body: 'Back from the dead' })
        .expect(404);
    });

    it('returns 404 for a nonexistent comment', async () => {
      await request(server)
        .patch(`/api/v1/events/${eventId}/comments/999999`)
        .set('Cookie', memberCookie)
        .send({ body: 'Nope' })
        .expect(404);
    });

    it('rejects an empty body', async () => {
      const created = await create(memberCookie);

      await request(server)
        .patch(`/api/v1/events/${eventId}/comments/${created.body.id}`)
        .set('Cookie', memberCookie)
        .send({ body: '' })
        .expect(400);
    });

    it('rejects unauthenticated requests', async () => {
      const created = await create(memberCookie);

      await request(server)
        .patch(`/api/v1/events/${eventId}/comments/${created.body.id}`)
        .send({ body: 'Anon edit' })
        .expect(401);
    });

    it('edits your own reply and rejects editing someone else\'s', async () => {
      const comment = await create(memberCookie, 'Top-level comment');
      const reply = await request(server)
        .post(`/api/v1/events/${eventId}/comments/${comment.body.id}/replies`)
        .set('Cookie', otherMemberCookie)
        .send({ body: 'A reply' })
        .expect(201);
      expect(reply.body.editedAt).toBeNull();

      const res = await request(server)
        .patch(`/api/v1/events/${eventId}/comments/${comment.body.id}/replies/${reply.body.id}`)
        .set('Cookie', otherMemberCookie)
        .send({ body: 'A revised reply' })
        .expect(200);
      expect(res.body.body).toBe('A revised reply');
      expect(res.body.editedAt).not.toBeNull();

      await request(server)
        .patch(`/api/v1/events/${eventId}/comments/${comment.body.id}/replies/${reply.body.id}`)
        .set('Cookie', memberCookie)
        .send({ body: 'Not mine to change' })
        .expect(403);
    });
  });

  describe('DELETE /events/:eventId/comments/:commentId', () => {
    it('deletes your own comment', async () => {
      const created = await request(server)
        .post(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', memberCookie)
        .send({ body: 'Delete me' })
        .expect(201);

      await request(server)
        .delete(`/api/v1/events/${eventId}/comments/${created.body.id}`)
        .set('Cookie', memberCookie)
        .expect(200);

      const res = await request(server)
        .get(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', memberCookie)
        .expect(200);
      expect(res.body.find((c: { id: number }) => c.id === created.body.id).deleted).toBe(true);
    });

    it('allows an admin to delete another member\'s comment', async () => {
      const created = await request(server)
        .post(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', memberCookie)
        .send({ body: 'Delete me' })
        .expect(201);

      await request(server)
        .delete(`/api/v1/events/${eventId}/comments/${created.body.id}`)
        .set('Cookie', adminCookie)
        .expect(200);
    });

    it('rejects deleting another member\'s comment', async () => {
      const created = await request(server)
        .post(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', memberCookie)
        .send({ body: 'Not yours' })
        .expect(201);

      await request(server)
        .delete(`/api/v1/events/${eventId}/comments/${created.body.id}`)
        .set('Cookie', otherMemberCookie)
        .expect(403);
    });

    it('returns 404 for a nonexistent comment', async () => {
      await request(server)
        .delete(`/api/v1/events/${eventId}/comments/999999`)
        .set('Cookie', memberCookie)
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      const created = await request(server)
        .post(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', memberCookie)
        .send({ body: 'Delete me' })
        .expect(201);

      await request(server).delete(`/api/v1/events/${eventId}/comments/${created.body.id}`).expect(401);
    });
  });

  describe('POST/DELETE replies', () => {
    it('adds and deletes a reply', async () => {
      const comment = await request(server)
        .post(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', memberCookie)
        .send({ body: 'Top-level comment' })
        .expect(201);

      const reply = await request(server)
        .post(`/api/v1/events/${eventId}/comments/${comment.body.id}/replies`)
        .set('Cookie', otherMemberCookie)
        .send({ body: 'A reply' })
        .expect(201);
      expect(reply.body).toMatchObject({ body: 'A reply' });

      await request(server)
        .delete(`/api/v1/events/${eventId}/comments/${comment.body.id}/replies/${reply.body.id}`)
        .set('Cookie', otherMemberCookie)
        .expect(200);
    });

    it('rejects a reply missing the body field', async () => {
      const comment = await request(server)
        .post(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', memberCookie)
        .send({ body: 'Top-level comment' })
        .expect(201);

      await request(server)
        .post(`/api/v1/events/${eventId}/comments/${comment.body.id}/replies`)
        .set('Cookie', otherMemberCookie)
        .send({})
        .expect(400);
    });

    it('returns 404 replying to a nonexistent comment', async () => {
      await request(server)
        .post(`/api/v1/events/${eventId}/comments/999999/replies`)
        .set('Cookie', memberCookie)
        .send({ body: 'A reply' })
        .expect(404);
    });

    it('rejects deleting another member\'s reply', async () => {
      const comment = await request(server)
        .post(`/api/v1/events/${eventId}/comments`)
        .set('Cookie', memberCookie)
        .send({ body: 'Top-level comment' })
        .expect(201);

      const reply = await request(server)
        .post(`/api/v1/events/${eventId}/comments/${comment.body.id}/replies`)
        .set('Cookie', otherMemberCookie)
        .send({ body: 'A reply' })
        .expect(201);

      await request(server)
        .delete(`/api/v1/events/${eventId}/comments/${comment.body.id}/replies/${reply.body.id}`)
        .set('Cookie', memberCookie)
        .expect(403);
    });
  });
});
