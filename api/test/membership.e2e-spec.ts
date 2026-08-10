import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City, event_rsvps as EventRsvp, locations as Location, users as User } from '@prisma/client';
import { RsvpStatus, UserRole } from '../src/database/enums';

// Phase 35: membership fee toggle (RSVP enforcement) + Residence "what are
// you bringing" field. Both live on EventsService.upsertRsvp.
describe('Membership fee + bringing item (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
  let location: Location;
  let residence: Location;
  let admin: User;
  let adminCookie: string;
  let moderatorCookie: string;
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
    residence = await seedLocation(prisma, city.id, { isResidence: true });

    admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const moderator = await seedUser(prisma, city.id, { role: UserRole.MODERATOR, email: 'mod@example.test' });
    member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    moderatorCookie = await loginAs(app, moderator);
    memberCookie = await loginAs(app, member);
  });

  async function createEvent(locId: number = location.id, overrides: Record<string, unknown> = {}): Promise<{ id: number }> {
    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 14);
    const created = await request(server)
      .post('/api/v1/events')
      .set('Cookie', adminCookie)
      .send({
        cityId: city.id,
        locationId: locId,
        title: 'Test Dinner',
        eventDate: eventDate.toISOString().slice(0, 10),
        eventTime: '18:30',
        status: 'published',
        ...overrides,
      })
      .expect(201);
    return created.body;
  }

  async function enableMembershipFeature(): Promise<void> {
    await request(server)
      .patch('/api/v1/admin/config/bulk')
      .set('Cookie', adminCookie)
      .send({ entries: [{ key: 'feature_require_membership', value: 'true' }] })
      .expect(200);
  }

  async function markAttendedOnPastEvent(userId: number): Promise<void> {
    // Direct DB write — simplest way to give a member attendance history
    // without needing a real past event + the full mark-attendance flow.
    await prisma.event_rsvps.create({ data: {
      eventId: (await createEvent()).id,
      userId,
      status: RsvpStatus.GOING,
      attended: true,
    } });
  }

  describe('membership enforcement', () => {
    it('allows a first-time RSVP Going with no membership (free meeting)', async () => {
      await enableMembershipFeature();
      const event = await createEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going' })
        .expect(201);
    });

    it('blocks a Going RSVP once the member has attended before and has no membership', async () => {
      await enableMembershipFeature();
      await markAttendedOnPastEvent(member.id);
      const event = await createEvent();

      const res = await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going' })
        .expect(403);
      expect(res.body.message).toContain('membership');
    });

    it('allows the Going RSVP when the member has an active, non-expired membership', async () => {
      await enableMembershipFeature();
      await markAttendedOnPastEvent(member.id);
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      await prisma.users.update({ where: { id: member.id }, data: {
        hasMembership: true,
        membershipExpiresAt: future,
      } });
      const event = await createEvent();

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going' })
        .expect(201);
    });

    it('still blocks when hasMembership is true but membershipExpiresAt is in the past', async () => {
      await enableMembershipFeature();
      await markAttendedOnPastEvent(member.id);
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await prisma.users.update({ where: { id: member.id }, data: {
        hasMembership: true,
        membershipExpiresAt: past,
      } });
      const event = await createEvent();

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going' })
        .expect(403);
    });

    it('never blocks a Maybe RSVP, membership or not', async () => {
      await enableMembershipFeature();
      await markAttendedOnPastEvent(member.id);
      const event = await createEvent();

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'maybe' })
        .expect(201);
    });

    it('lets admins and moderators bypass the block regardless of membership', async () => {
      await enableMembershipFeature();
      const event = await createEvent();

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', adminCookie)
        .send({ status: 'going' })
        .expect(201);
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', moderatorCookie)
        .send({ status: 'going' })
        .expect(201);
    });

    it('does not enforce at all when the feature toggle is off', async () => {
      // Toggle left at its default (false) — never enabled in this test.
      await markAttendedOnPastEvent(member.id);
      const event = await createEvent();

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going' })
        .expect(201);
    });
  });

  describe('POST /admin/users/:id/membership', () => {
    it('sets hasMembership and defaults expiration to next Jan 1 when none given', async () => {
      const res = await request(server)
        .post(`/api/v1/admin/users/${member.id}/membership`)
        .set('Cookie', adminCookie)
        .send({ hasMembership: true })
        .expect(200);

      expect(res.body.hasMembership).toBe(true);
      const expiresAt = new Date(res.body.membershipExpiresAt);
      expect(expiresAt.getUTCMonth()).toBe(0);
      expect(expiresAt.getUTCDate()).toBe(1);
      expect(expiresAt.getFullYear()).toBeGreaterThan(new Date().getFullYear() - 1);
    });

    it('respects an explicit membershipExpiresAt', async () => {
      const res = await request(server)
        .post(`/api/v1/admin/users/${member.id}/membership`)
        .set('Cookie', adminCookie)
        .send({ hasMembership: true, membershipExpiresAt: '2030-06-15' })
        .expect(200);

      expect(new Date(res.body.membershipExpiresAt).toISOString().slice(0, 10)).toBe('2030-06-15');
    });

    it('clears the expiration when membership is turned off', async () => {
      await request(server)
        .post(`/api/v1/admin/users/${member.id}/membership`)
        .set('Cookie', adminCookie)
        .send({ hasMembership: true })
        .expect(200);

      const res = await request(server)
        .post(`/api/v1/admin/users/${member.id}/membership`)
        .set('Cookie', adminCookie)
        .send({ hasMembership: false })
        .expect(200);

      expect(res.body.hasMembership).toBe(false);
      expect(res.body.membershipExpiresAt).toBeNull();
    });

    it('is role-gated to admin/moderator', async () => {
      await request(server)
        .post(`/api/v1/admin/users/${member.id}/membership`)
        .set('Cookie', memberCookie)
        .send({ hasMembership: true })
        .expect(403);
    });

    it('rejects unauthenticated requests', async () => {
      await request(server)
        .post(`/api/v1/admin/users/${member.id}/membership`)
        .send({ hasMembership: true })
        .expect(401);
    });
  });

  describe('bringing item', () => {
    it('persists a bringingItem and round-trips on GET /events/:id', async () => {
      const event = await createEvent(residence.id);
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going', bringingItem: 'A salad' })
        .expect(201);

      const res = await request(server).get(`/api/v1/events/${event.id}`).set('Cookie', memberCookie).expect(200);
      const rsvp = res.body.rsvps.find((r: { userId: number }) => r.userId === member.id);
      expect(rsvp.bringingItem).toBe('A salad');
    });

    it('normalizes a blank/whitespace bringingItem to null', async () => {
      const event = await createEvent(residence.id);
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going', bringingItem: '   ' })
        .expect(201);

      const rsvp = await prisma.event_rsvps.findFirst({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp!.bringingItem).toBeNull();
    });

    it('accepts bringingItem regardless of location type (not server-enforced to Residence)', async () => {
      const event = await createEvent(location.id); // not a residence
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going', bringingItem: 'Chips' })
        .expect(201);

      const rsvp = await prisma.event_rsvps.findFirst({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp!.bringingItem).toBe('Chips');
    });

    it('rejects a bringingItem over 200 chars', async () => {
      const event = await createEvent(residence.id);
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going', bringingItem: 'x'.repeat(201) })
        .expect(400);
    });
  });
});
