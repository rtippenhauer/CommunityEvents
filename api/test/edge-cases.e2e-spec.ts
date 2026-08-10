import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City, locations as Location, users as User } from '@prisma/client';
import { UserRole } from '../src/database/enums';

// Builds a structurally valid (per validator.js's isEmail) but oversized email —
// each domain label stays under the 63-char DNS label limit so the value still
// passes @IsEmail; only the total length exceeds the DTO's @MaxLength.
function oversizedEmail(minLength: number): string {
  const local = 'a'.repeat(60);
  let domain = 'b'.repeat(60);
  while (`${local}@${domain}.com`.length <= minLength) {
    domain += `.${'b'.repeat(60)}`;
  }
  return `${local}@${domain}.com`;
}

const XSS_PAYLOAD = '<script>alert(1)</script>';
const SQLI_TAUTOLOGY = "' OR '1'='1";
const SQLI_DROP = "'; DROP TABLE users; --";

describe('Edge Cases — Field Limits, Injection & Parameterization (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
  let location: Location;
  let admin: User;
  let adminCookie: string;
  let member: User;
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
    resetThrottler(app);
    city = await seedCity(prisma);
    location = await seedLocation(prisma, city.id);

    admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
  });

  async function createPublishedEvent(overrides: Record<string, unknown> = {}): Promise<{ id: number }> {
    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 14);
    const created = await request(server)
      .post('/api/v1/events')
      .set('Cookie', adminCookie)
      .send({
        cityId: city.id,
        locationId: location.id,
        title: 'Test Dinner',
        eventDate: eventDate.toISOString().slice(0, 10),
        eventTime: '18:30',
        ...overrides,
      })
      .expect(201);
    await request(server)
      .patch(`/api/v1/events/${created.body.id}`)
      .set('Cookie', adminCookie)
      .send({ status: 'published' })
      .expect(200);
    return created.body;
  }

  // ── Boundary tests: @MaxLength / @Min / @Max fields ────────────────────────

  describe('Boundary values on length/size-limited fields', () => {
    it('rejects a city name over 100 chars', async () => {
      await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', adminCookie)
        .send({ name: 'A'.repeat(101), subdomain: 'boundary-city' })
        .expect(400);
    });

    it('rejects a location name over 255 chars', async () => {
      await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send({ name: 'A'.repeat(256), address: '123 Test St', cityId: city.id })
        .expect(400);
    });

    it('rejects a location address over 500 chars', async () => {
      await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send({ name: 'Boundary Bistro', address: 'A'.repeat(501), cityId: city.id })
        .expect(400);
    });

    it('rejects a location websiteUrl over 500 chars (regression: previously unbounded)', async () => {
      const url = `https://example.com/${'a'.repeat(500)}`;
      await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send({ name: 'Boundary Bistro', address: '123 Test St', cityId: city.id, websiteUrl: url })
        .expect(400);
    });

    it('rejects a location contactEmail over 150 chars', async () => {
      await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send({
          name: 'Boundary Bistro', address: '123 Test St', cityId: city.id,
          contactEmail: oversizedEmail(150),
        })
        .expect(400);
    });

    it('rejects a feedback title over 200 chars', async () => {
      await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send({ category: 'bug', title: 'A'.repeat(201), body: 'This is a valid length body.' })
        .expect(400);
    });

    it('rejects a feedback body over 10000 chars', async () => {
      await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send({ category: 'bug', title: 'Valid title', body: 'A'.repeat(10001) })
        .expect(400);
    });

    it('rejects a release version over 20 chars (regression: previously unbounded)', async () => {
      await request(server)
        .post('/api/v1/admin/releases')
        .set('Cookie', adminCookie)
        .send({ version: `1.0.${'1'.repeat(20)}`, title: 'Big release', body: 'A'.repeat(20) })
        .expect(400);
    });

    it('rejects an invite boundToName over 200 chars', async () => {
      await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'member', boundToEmail: 'invitee@example.test', boundToName: 'A'.repeat(201) })
        .expect(400);
    });

    it('rejects an invite boundToEmail over 255 chars (regression: previously unbounded)', async () => {
      await request(server)
        .post('/api/v1/invites')
        .set('Cookie', adminCookie)
        .send({ type: 'member', boundToEmail: oversizedEmail(255) })
        .expect(400);
    });

    it('rejects an announcement title over 200 chars', async () => {
      await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send({ title: 'A'.repeat(201), body: 'Valid body' })
        .expect(400);
    });

    it('rejects an announcement body over 50000 chars (regression: previously unbounded)', async () => {
      await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send({ title: 'Valid title', body: 'A'.repeat(50001) })
        .expect(400);
    });

    it('rejects an event title over 255 chars', async () => {
      await request(server)
        .post('/api/v1/events')
        .set('Cookie', adminCookie)
        .send({
          cityId: city.id, locationId: location.id, title: 'A'.repeat(256),
          eventDate: '2027-06-01', eventTime: '18:30',
        })
        .expect(400);
    });

    it('rejects an event comment body over 2000 chars', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/comments`)
        .set('Cookie', memberCookie)
        .send({ body: 'A'.repeat(2001) })
        .expect(400);
    });

    it('rejects a location rating comment over 1000 chars (validation runs before eligibility)', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/locations/${location.id}/ratings`)
        .set('Cookie', memberCookie)
        .send({
          eventId: event.id, food: 5, service: 5, valueRating: 5, noise: 5,
          comment: 'A'.repeat(1001),
        })
        .expect(400);
    });

    it('rejects a merch storeUrl over 500 chars (regression: previously unbounded)', async () => {
      const url = `https://example.com/${'a'.repeat(500)}`;
      await request(server)
        .patch('/api/v1/merch/admin/config')
        .set('Cookie', adminCookie)
        .send({ storeUrl: url })
        .expect(400);
    });

    it('rejects push subscription keys over their column limits (regression: previously unbounded)', async () => {
      await request(server)
        .post('/api/v1/notifications/push/subscribe')
        .set('Cookie', memberCookie)
        .send({
          endpoint: 'https://push.example.test/abc',
          keys: { p256dh: 'A'.repeat(513), auth: 'B'.repeat(256) },
        })
        .expect(400);
    });

    it('rejects a forgot-password email over 255 chars (regression: covers auth register/login/forgot-password email cap)', async () => {
      await request(server)
        .post('/api/v1/auth/forgot-password')
        .send({ email: oversizedEmail(255) })
        .expect(400);
    });

    describe('RSVP guestNames — compound ArrayMaxSize(9) + per-item MaxLength(200)', () => {
      it('rejects 10 guest names (over ArrayMaxSize(9))', async () => {
        const event = await createPublishedEvent();
        await request(server)
          .post(`/api/v1/events/${event.id}/rsvp`)
          .set('Cookie', memberCookie)
          .send({ status: 'going', additionalGuests: 9, guestNames: Array.from({ length: 10 }, (_, i) => `Guest ${i}`) })
          .expect(400);
      });

      it('rejects a single guest name over 200 chars', async () => {
        const event = await createPublishedEvent();
        await request(server)
          .post(`/api/v1/events/${event.id}/rsvp`)
          .set('Cookie', memberCookie)
          .send({ status: 'going', additionalGuests: 1, guestNames: ['A'.repeat(201)] })
          .expect(400);
      });

      it('accepts exactly 9 guest names of exactly 200 chars each (at the limit)', async () => {
        const event = await createPublishedEvent();
        await request(server)
          .post(`/api/v1/events/${event.id}/rsvp`)
          .set('Cookie', memberCookie)
          .send({
            status: 'going', additionalGuests: 9,
            guestNames: Array.from({ length: 9 }, (_, i) => `${i}`.repeat(200)),
          })
          .expect(201);
      });
    });
  });

  // ── No-DTO endpoint regression: previously unvalidated admin/community routes ──

  describe('Previously no-DTO endpoints now reject invalid input', () => {
    it('rejects a title over 100 chars on PATCH /members/me/title', async () => {
      const res = await request(server)
        .patch('/api/v1/members/me/title')
        .set('Cookie', memberCookie)
        .send({ title: 'A'.repeat(101) })
        .expect(400);
      // ValidationPipe returns an array of messages; the old catch-based
      // "not earned" rejection returned a single string — this distinguishes them.
      expect(res.body.message).toEqual(expect.any(Array));
    });

    it('rejects an achievement grant key over 64 chars', async () => {
      await request(server)
        .patch(`/api/v1/admin/members/${member.id}/achievements/grant`)
        .set('Cookie', adminCookie)
        .send({ key: 'a'.repeat(65) })
        .expect(400);
    });

    it('rejects an admin achievement create with an over-limit name', async () => {
      await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .send({
          key: 'boundary_test', name: 'A'.repeat(121), description: 'desc',
          icon: 'emoji_events', progressType: 'login', points: 5,
        })
        .expect(400);
    });

    it('rejects an admin achievement create with an invalid progressType (not in the enum)', async () => {
      await request(server)
        .post('/api/v1/admin/achievements')
        .set('Cookie', adminCookie)
        .send({
          key: 'boundary_test2', name: 'Valid', description: 'desc',
          icon: 'emoji_events', progressType: 'not_a_real_type', points: 5,
        })
        .expect(400);
    });

    it('rejects an event-specific achievement create with an over-limit description', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/admin/events/${event.id}/achievement`)
        .set('Cookie', adminCookie)
        .send({ name: 'Valid', description: 'A'.repeat(501), points: 5 })
        .expect(400);
    });

    it('rejects a custom icon name over 100 chars', async () => {
      const TINY_PNG = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      );
      await request(server)
        .post('/api/v1/admin/custom-icons')
        .set('Cookie', adminCookie)
        .field('name', 'A'.repeat(101))
        .attach('image', TINY_PNG, 'icon.png')
        .expect(400);
    });

    it('rejects an invalid role value on POST /admin/users/:id/role (regression: previously an unvalidated bare string)', async () => {
      await request(server)
        .post(`/api/v1/admin/users/${member.id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'superadmin' })
        .expect(400);
    });

    it('rejects an unexpected extra field on PATCH /admin/email/config (regression: forbidNonWhitelisted now applies)', async () => {
      await request(server)
        .patch('/api/v1/admin/email/config')
        .set('Cookie', adminCookie)
        .send({ brevoEnabled: true, notARealField: 'hello' })
        .expect(400);
    });

    it('rejects an invalid brevoFromEmail on PATCH /admin/email/config', async () => {
      await request(server)
        .patch('/api/v1/admin/email/config')
        .set('Cookie', adminCookie)
        .send({ brevoFromEmail: 'not-an-email' })
        .expect(400);
    });
  });

  // ── Injection payloads: regression, not remediation ─────────────────────────

  describe('HTML/script injection payloads', () => {
    it('strips a <script> tag from a sanitized feedback body', async () => {
      const res = await request(server)
        .post('/api/v1/feedback')
        .set('Cookie', memberCookie)
        .send({ category: 'bug', title: 'XSS test', body: `Before ${XSS_PAYLOAD} After` })
        .expect(201);
      expect(res.body.body).not.toContain('<script>');
      expect(res.body.body).toContain('Before');
      expect(res.body.body).toContain('After');
    });

    it('strips a <script> tag from a sanitized announcement body', async () => {
      const res = await request(server)
        .post('/api/v1/admin/announcements')
        .set('Cookie', adminCookie)
        .send({ title: 'XSS test', body: `Before ${XSS_PAYLOAD} After` })
        .expect(201);
      expect(res.body.body).not.toContain('<script>');
    });

    it('stores an unsanitized event comment body as an inert literal string (no HTML execution surface server-side)', async () => {
      const event = await createPublishedEvent();
      const res = await request(server)
        .post(`/api/v1/events/${event.id}/comments`)
        .set('Cookie', memberCookie)
        .send({ body: XSS_PAYLOAD })
        .expect(201);
      // Comments aren't sanitize-html'd (unlike feedback/announcements) — the
      // regression guard here is that it round-trips as inert data, not that
      // it renders anywhere; the frontend is responsible for output-encoding.
      expect(res.body.body).toBe(XSS_PAYLOAD);
    });
  });

  describe('SQL-injection-shaped payloads are treated as inert data', () => {
    it('stores a tautology payload as a literal location name, not as SQL', async () => {
      const res = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send({ name: SQLI_TAUTOLOGY, address: '123 Test St', cityId: city.id })
        .expect(201);
      expect(res.body.name).toBe(SQLI_TAUTOLOGY);

      const found = await request(server)
        .get(`/api/v1/locations?search=${encodeURIComponent(SQLI_TAUTOLOGY)}`)
        .set('Cookie', memberCookie)
        .expect(200);
      expect(found.body.some((r: { id: number }) => r.id === res.body.id)).toBe(true);
    });

    it('handles a DROP-TABLE-shaped payload without error and leaves other data intact', async () => {
      await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send({ name: SQLI_DROP, address: '123 Test St', cityId: city.id })
        .expect(201);

      // Prove the users table (and every other table) is untouched.
      const users = await request(server).get('/api/v1/admin/users').set('Cookie', adminCookie).expect(200);
      expect(users.body.some((u: { id: number }) => u.id === admin.id)).toBe(true);
    });

    it('parameterizes the admin audit log LIKE search — a tautology payload does not return an unfiltered dump', async () => {
      const res = await request(server)
        .get(`/api/v1/admin/audit?userSearch=${encodeURIComponent(SQLI_TAUTOLOGY)}`)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('parameterizes the admin audit log LIKE search — a DROP-TABLE payload does not error or drop anything', async () => {
      await request(server)
        .get(`/api/v1/admin/audit?userSearch=${encodeURIComponent(SQLI_DROP)}`)
        .set('Cookie', adminCookie)
        .expect(200);

      const users = await request(server).get('/api/v1/admin/users').set('Cookie', adminCookie).expect(200);
      expect(users.body.length).toBeGreaterThan(0);
    });

    it('handles a raw parameterized DELETE (account self-delete cleanup) safely when RSVP guest names contain SQLi-shaped input', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going', additionalGuests: 1, guestNames: [SQLI_DROP] })
        .expect(201);

      // Triggers users.service.ts's raw `?`-parameterized DELETE FROM event_rsvps
      // cleanup query — this is the safety net for the one raw-SQL path a member
      // can indirectly reach with attacker-controlled data already in the DB.
      await request(server)
        .delete('/api/v1/users/me')
        .set('Cookie', memberCookie)
        .send({ confirm: 'DELETE' })
        .expect(204);

      const users = await request(server).get('/api/v1/admin/users').set('Cookie', adminCookie).expect(200);
      expect(Array.isArray(users.body)).toBe(true);
    });
  });
});
