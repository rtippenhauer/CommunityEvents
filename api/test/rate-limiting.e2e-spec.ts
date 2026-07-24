import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedUser, loginAs } from './utils/seed';
import { CityEntity } from '../src/database/entities/city.entity';
import { UserEntity, UserRole } from '../src/database/entities/user.entity';

// Fires `count` requests sequentially and returns each response's status —
// sequential (not Promise.all) so hits land in the guard's window in a
// predictable order for asserting exactly where the 429 boundary falls.
async function fireSequential(
  count: number,
  makeRequest: () => Promise<{ status: number }>,
): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const res = await makeRequest();
    statuses.push(res.status);
  }
  return statuses;
}

describe('Rate Limiting (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let server: Parameters<typeof request>[0];

  let city: CityEntity;
  let admin: UserEntity;
  let adminCookie: string;
  let member: UserEntity;
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
    resetThrottler(app);
    city = await seedCity(dataSource);
    admin = await seedUser(dataSource, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    member = await seedUser(dataSource, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
  });

  describe('Generic write-route default (30/min)', () => {
    it('throttles a write route that never declared its own @Throttle at 30/min', async () => {
      const statuses = await fireSequential(31, () =>
        request(server)
          .post('/api/v1/events/999999/comments')
          .set('Cookie', memberCookie)
          .send({ body: 'hello' }),
      );
      expect(statuses.slice(0, 30).some((s) => s === 429)).toBe(false);
      expect(statuses[30]).toBe(429);
    });
  });

  describe('Generic read-route default (60/min, unchanged)', () => {
    it('still allows 60/min on a route with no explicit @Throttle', async () => {
      const statuses = await fireSequential(61, () => request(server).get('/api/v1/locations'));
      expect(statuses.slice(0, 60).some((s) => s === 429)).toBe(false);
      expect(statuses[60]).toBe(429);
    });
  });

  describe('Existing explicit @Throttle regression check', () => {
    it('still enforces /auth/register at 5/min (not clobbered by the new write default)', async () => {
      const statuses = await fireSequential(6, () =>
        request(server).post('/api/v1/auth/register').send({}),
      );
      expect(statuses.slice(0, 5).some((s) => s === 429)).toBe(false);
      expect(statuses[5]).toBe(429);
    });
  });

  describe('Bespoke tightened routes', () => {
    it('throttles POST /events/:id/public-rsvp at 10/min', async () => {
      const statuses = await fireSequential(11, () =>
        request(server)
          .post('/api/v1/events/999999/public-rsvp')
          .send({ name: 'Guest', email: 'guest@example.test' }),
      );
      expect(statuses.slice(0, 10).some((s) => s === 429)).toBe(false);
      expect(statuses[10]).toBe(429);
    });

    it('throttles POST /events/guest-link/:token at 10/min', async () => {
      const statuses = await fireSequential(11, () =>
        request(server).post('/api/v1/events/guest-link/bogus-token').send({}),
      );
      expect(statuses.slice(0, 10).some((s) => s === 429)).toBe(false);
      expect(statuses[10]).toBe(429);
    });

    it('throttles DELETE /events/guest-link/:token at 10/min', async () => {
      const statuses = await fireSequential(11, () =>
        request(server).delete('/api/v1/events/guest-link/bogus-token'),
      );
      expect(statuses.slice(0, 10).some((s) => s === 429)).toBe(false);
      expect(statuses[10]).toBe(429);
    });

    it('throttles POST /events/reservation-confirm/:token at 10/min', async () => {
      const statuses = await fireSequential(11, () =>
        request(server).post('/api/v1/events/reservation-confirm/bogus-token'),
      );
      expect(statuses.slice(0, 10).some((s) => s === 429)).toBe(false);
      expect(statuses[10]).toBe(429);
    });

    it('throttles POST /locations/enrich/bulk at 5/min', async () => {
      // No locations seeded, so the fire-and-forget bulk enrich has nothing
      // to iterate — safe to call repeatedly without hitting a real API
      // (GOOGLE_PLACES_API_KEY is unset in the test env regardless).
      const statuses = await fireSequential(6, () =>
        request(server).post('/api/v1/locations/enrich/bulk').set('Cookie', adminCookie),
      );
      expect(statuses.slice(0, 5).some((s) => s === 429)).toBe(false);
      expect(statuses[5]).toBe(429);
    });

    it('throttles GET /locations/place-search at 20/min', async () => {
      // GOOGLE_PLACES_API_KEY is unset in the test env, so this short-circuits
      // to an empty array without a real network call.
      const statuses = await fireSequential(21, () =>
        request(server)
          .get('/api/v1/locations/place-search')
          .query({ q: 'test' })
          .set('Cookie', adminCookie),
      );
      expect(statuses.slice(0, 20).some((s) => s === 429)).toBe(false);
      expect(statuses[20]).toBe(429);
    });

    it('throttles POST /admin/users/:id/role at 10/min', async () => {
      const statuses = await fireSequential(11, () =>
        request(server)
          .post(`/api/v1/admin/users/${member.id}/role`)
          .set('Cookie', adminCookie)
          .send({ role: UserRole.MEMBER }),
      );
      expect(statuses.slice(0, 10).some((s) => s === 429)).toBe(false);
      expect(statuses[10]).toBe(429);
    });

    it('throttles POST /admin/achievements/backfill-founders at 5/min', async () => {
      const statuses = await fireSequential(6, () =>
        request(server)
          .post('/api/v1/admin/achievements/backfill-founders')
          .set('Cookie', adminCookie),
      );
      expect(statuses.slice(0, 5).some((s) => s === 429)).toBe(false);
      expect(statuses[5]).toBe(429);
    });

    it('throttles POST /admin/achievements/backfill-invites at 5/min', async () => {
      const statuses = await fireSequential(6, () =>
        request(server)
          .post('/api/v1/admin/achievements/backfill-invites')
          .set('Cookie', adminCookie),
      );
      expect(statuses.slice(0, 5).some((s) => s === 429)).toBe(false);
      expect(statuses[5]).toBe(429);
    });

    it('throttles POST /admin/achievements/recalculate-points at 5/min', async () => {
      const statuses = await fireSequential(6, () =>
        request(server)
          .post('/api/v1/admin/achievements/recalculate-points')
          .set('Cookie', adminCookie),
      );
      expect(statuses.slice(0, 5).some((s) => s === 429)).toBe(false);
      expect(statuses[5]).toBe(429);
    });
  });

  describe('Brevo webhook secret gating', () => {
    const event = { event: 'delivered', email: 'test@example.test' };

    it('rejects with 401 when the secret is missing', async () => {
      await request(server).post('/api/v1/email/webhook/brevo').send(event).expect(401);
    });

    it('rejects with 401 when the secret is wrong', async () => {
      await request(server)
        .post('/api/v1/email/webhook/brevo')
        .query({ secret: 'wrong-secret' })
        .send(event)
        .expect(401);
    });

    it('accepts and processes the event with the correct secret', async () => {
      await request(server)
        .post('/api/v1/email/webhook/brevo')
        .query({ secret: process.env.BREVO_WEBHOOK_SECRET })
        .send(event)
        .expect(201)
        .then((res) => {
          expect(res.body).toEqual({ ok: true });
        });
    });
  });
});
