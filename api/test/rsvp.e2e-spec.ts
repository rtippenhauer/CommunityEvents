import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City, event_guest_links as EventGuestLink, event_rsvps as EventRsvp, events as Event, locations as Location, member_points as MemberPoint, users as User } from '@prisma/client';
import { PointType, RsvpStatus, UserRole } from '../src/database/enums';

// Converts an offset from "now" into the Eastern calendar date + wall-clock time
// events.service's cutoff logic reasons about, so cutoff tests aren't tied to a
// fixed future date and remain correct regardless of when the suite runs.
function easternDateTimeFromNow(offsetMinutes: number): { eventDate: string; eventTime: string } {
  const target = new Date(Date.now() + offsetMinutes * 60 * 1000);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(target);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { eventDate: `${get('year')}-${get('month')}-${get('day')}`, eventTime: `${hour}:${get('minute')}` };
}

describe('RSVP Lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
  let location: Location;
  let admin: User;
  let adminCookie: string;
  let moderatorCookie: string;
  let member: User;
  let memberCookie: string;
  let member2: User;
  let member2Cookie: string;

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
    const moderator = await seedUser(prisma, city.id, { role: UserRole.MODERATOR, email: 'mod@example.test' });
    member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    member2 = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member2@example.test' });
    adminCookie = await loginAs(app, admin);
    moderatorCookie = await loginAs(app, moderator);
    memberCookie = await loginAs(app, member);
    member2Cookie = await loginAs(app, member2);
  });

  async function createEvent(overrides: Record<string, unknown> = {}): Promise<{ id: number }> {
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
    return created.body;
  }

  async function createPublishedEvent(overrides: Record<string, unknown> = {}): Promise<{ id: number }> {
    const event = await createEvent(overrides);
    await request(server).patch(`/api/v1/events/${event.id}`).set('Cookie', adminCookie).send({ status: 'published' }).expect(200);
    return event;
  }

  describe('POST /events/:id/rsvp + DELETE /events/:id/rsvp', () => {
    it('creates a Going RSVP with default fields', async () => {
      const event = await createPublishedEvent();

      const res = await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({})
        .expect(201);

      expect(res.body.status).toBe('going');
      expect(res.body.additionalGuests).toBe(0);
    });

    it('upserts an existing RSVP, changing status and guest count', async () => {
      const event = await createPublishedEvent();
      await request(server).post(`/api/v1/events/${event.id}/rsvp`).set('Cookie', memberCookie).send({ status: 'going' }).expect(201);

      const res = await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'maybe', additionalGuests: 3, guestNames: ['Alice', 'Bob', 'Carol'] })
        .expect(201);

      expect(res.body.status).toBe('maybe');
      expect(res.body.additionalGuests).toBe(3);
      expect(res.body.guestNames).toEqual(['Alice', 'Bob', 'Carol']);

      const rows = await prisma.event_rsvps.findMany({ where: { eventId: event.id, userId: member.id } });
      expect(rows).toHaveLength(1);
    });

    it('rejects an additionalGuests value above 9', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ additionalGuests: 10 })
        .expect(400);
    });

    it('rejects an invalid status value', async () => {
      const event = await createPublishedEvent();
      await request(server).post(`/api/v1/events/${event.id}/rsvp`).set('Cookie', memberCookie).send({ status: 'attending' }).expect(400);
    });

    it('rejects RSVPing to a draft (unpublished) event', async () => {
      const event = await createEvent();
      await request(server).post(`/api/v1/events/${event.id}/rsvp`).set('Cookie', memberCookie).send({}).expect(400);
    });

    it('returns 404 for a nonexistent event', async () => {
      await request(server).post('/api/v1/events/999999/rsvp').set('Cookie', memberCookie).send({}).expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      const event = await createPublishedEvent();
      await request(server).post(`/api/v1/events/${event.id}/rsvp`).send({}).expect(401);
    });

    it('removes an RSVP', async () => {
      const event = await createPublishedEvent();
      await request(server).post(`/api/v1/events/${event.id}/rsvp`).set('Cookie', memberCookie).send({}).expect(201);

      await request(server).delete(`/api/v1/events/${event.id}/rsvp`).set('Cookie', memberCookie).expect(200);

      const row = await prisma.event_rsvps.findFirst({ where: { eventId: event.id, userId: member.id } });
      expect(row).toBeNull();
    });

    it('no-ops when removing an RSVP that does not exist', async () => {
      const event = await createPublishedEvent();
      await request(server).delete(`/api/v1/events/${event.id}/rsvp`).set('Cookie', memberCookie).expect(200);
    });
  });

  describe('RSVP cutoff enforcement (150 minutes before start)', () => {
    it('blocks a member from a new Going RSVP once the cutoff has passed', async () => {
      const { eventDate, eventTime } = easternDateTimeFromNow(30);
      const event = await createPublishedEvent({ eventDate, eventTime });

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going' })
        .expect(403);
    });

    it('allows a moderator to RSVP Going past the cutoff', async () => {
      const { eventDate, eventTime } = easternDateTimeFromNow(30);
      const event = await createPublishedEvent({ eventDate, eventTime });

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', moderatorCookie)
        .send({ status: 'going' })
        .expect(201);
    });

    it('allows a Going RSVP well before the cutoff', async () => {
      const { eventDate, eventTime } = easternDateTimeFromNow(300);
      const event = await createPublishedEvent({ eventDate, eventTime });

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going' })
        .expect(201);
    });

    it('blocks increasing the guest count on an existing Going RSVP past the cutoff, but allows decreasing it', async () => {
      const { eventDate, eventTime } = easternDateTimeFromNow(30);
      const event = await createPublishedEvent({ eventDate, eventTime });
      await prisma.event_rsvps.create({ data: {
        eventId: event.id,
        userId: member.id,
        status: RsvpStatus.GOING,
        additionalGuests: 2,
      } });

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going', additionalGuests: 3 })
        .expect(403);

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going', additionalGuests: 1 })
        .expect(201);
    });

    it('always allows switching to maybe/not_going past the cutoff', async () => {
      const { eventDate, eventTime } = easternDateTimeFromNow(30);
      const event = await createPublishedEvent({ eventDate, eventTime });
      await prisma.event_rsvps.create({ data: {
        eventId: event.id,
        userId: member.id,
        status: RsvpStatus.GOING,
        additionalGuests: 1,
      } });

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'not_going', additionalGuests: 1 })
        .expect(201);
    });
  });

  describe('Member-generated guest links', () => {
    it('generates a guest link once the member has RSVPd', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ additionalGuests: 1 })
        .expect(201);

      const res = await request(server)
        .post(`/api/v1/events/${event.id}/rsvp/link`)
        .set('Cookie', memberCookie)
        .send({ recipientName: 'Guest One' })
        .expect(201);

      expect(res.body.token).toBeTruthy();
    });

    it('rejects generating a link with no prior RSVP', async () => {
      const event = await createPublishedEvent();
      await request(server).post(`/api/v1/events/${event.id}/rsvp/link`).set('Cookie', memberCookie).send({}).expect(400);
    });

    it('rejects generating more links than additionalGuests allows', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ additionalGuests: 1 })
        .expect(201);
      await request(server).post(`/api/v1/events/${event.id}/rsvp/link`).set('Cookie', memberCookie).send({}).expect(201);

      await request(server).post(`/api/v1/events/${event.id}/rsvp/link`).set('Cookie', memberCookie).send({}).expect(400);
    });

    it('allows a second link once additionalGuests is bumped', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ additionalGuests: 1 })
        .expect(201);
      await request(server).post(`/api/v1/events/${event.id}/rsvp/link`).set('Cookie', memberCookie).send({}).expect(201);

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ additionalGuests: 2 })
        .expect(201);
      await request(server).post(`/api/v1/events/${event.id}/rsvp/link`).set('Cookie', memberCookie).send({}).expect(201);
    });

    it('rejects a non-validated member generating a guest link', async () => {
      const event = await createPublishedEvent();
      const nonValidated = await seedUser(prisma, city.id, { role: UserRole.NON_VALIDATED, email: 'nv@example.test' });
      const cookie = await loginAs(app, nonValidated);

      await request(server).post(`/api/v1/events/${event.id}/rsvp/link`).set('Cookie', cookie).send({}).expect(403);
    });

    it('lets the inviting member remove a guest link they created, decrementing their guest count', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ additionalGuests: 1, guestNames: ['Removable Guest'] })
        .expect(201);
      const link = await request(server)
        .post(`/api/v1/events/${event.id}/rsvp/link`)
        .set('Cookie', memberCookie)
        .send({})
        .expect(201);

      await request(server)
        .delete(`/api/v1/events/${event.id}/rsvp/link/${link.body.id}`)
        .set('Cookie', memberCookie)
        .expect(200);

      const rsvp = await prisma.event_rsvps.findFirst({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp!.additionalGuests).toBe(0);
      const remainingLink = await prisma.event_guest_links.findFirst({ where: { id: link.body.id } });
      expect(remainingLink).toBeNull();
    });

    it("rejects removing another member's guest link", async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ additionalGuests: 1 })
        .expect(201);
      const link = await request(server).post(`/api/v1/events/${event.id}/rsvp/link`).set('Cookie', memberCookie).send({}).expect(201);

      await request(server)
        .delete(`/api/v1/events/${event.id}/rsvp/link/${link.body.id}`)
        .set('Cookie', member2Cookie)
        .expect(403);
    });

    it('rejects removing a public-sourced guest link through the member route', async () => {
      const event = await createPublishedEvent();
      const publicLink = await prisma.event_guest_links.create({ data: {
        eventId: event.id,
        createdById: null,
        memberRsvpId: null,
        deliveryType: 'email',
        source: 'public',
        recipientEmail: 'public-guest@example.test',
        token: `public-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      } });

      await request(server)
        .delete(`/api/v1/events/${event.id}/rsvp/link/${publicLink.id}`)
        .set('Cookie', memberCookie)
        .expect(400);
    });
  });

  describe('Public guest-link endpoints (no auth)', () => {
    it('previews an unused guest link', async () => {
      const event = await createPublishedEvent();
      const link = await prisma.event_guest_links.create({ data: {
        eventId: event.id,
        createdById: member.id,
        deliveryType: 'shareable',
        source: 'member',
        token: `preview-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      } });

      const res = await request(server).get(`/api/v1/events/guest-link/${link.token}`).expect(200);
      expect(res.body.usedAt).toBeNull();
    });

    it('returns 404 for an unknown token', async () => {
      await request(server).get('/api/v1/events/guest-link/nonexistent-token').expect(404);
    });

    it('confirms an unused, unexpired guest link', async () => {
      const event = await createPublishedEvent();
      const link = await prisma.event_guest_links.create({ data: {
        eventId: event.id,
        createdById: member.id,
        deliveryType: 'shareable',
        source: 'member',
        token: `use-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      } });

      await request(server).post(`/api/v1/events/guest-link/${link.token}`).send({ guestName: 'Walk Up' }).expect(201);

      const updated = await prisma.event_guest_links.findFirst({ where: { id: link.id } });
      expect(updated!.usedAt).toBeTruthy();
      expect(updated!.recipientName).toBe('Walk Up');
    });

    it('rejects using an already-used link', async () => {
      const event = await createPublishedEvent();
      const link = await prisma.event_guest_links.create({ data: {
        eventId: event.id,
        createdById: member.id,
        deliveryType: 'shareable',
        source: 'member',
        token: `already-used-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        usedAt: new Date(),
      } });

      await request(server).post(`/api/v1/events/guest-link/${link.token}`).send({}).expect(400);
    });

    it('rejects using an expired link', async () => {
      const event = await createPublishedEvent();
      const link = await prisma.event_guest_links.create({ data: {
        eventId: event.id,
        createdById: member.id,
        deliveryType: 'shareable',
        source: 'member',
        token: `expired-${Date.now()}`,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      } });

      await request(server).post(`/api/v1/events/guest-link/${link.token}`).send({}).expect(400);
    });

    it('cancels a guest link, and allows it to be reused after cancellation', async () => {
      const event = await createPublishedEvent();
      const link = await prisma.event_guest_links.create({ data: {
        eventId: event.id,
        createdById: member.id,
        deliveryType: 'shareable',
        source: 'member',
        token: `cancel-reuse-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        usedAt: new Date(),
      } });

      // Already used, not yet cancelled — a second use attempt is rejected
      await request(server).post(`/api/v1/events/guest-link/${link.token}`).send({}).expect(400);

      await request(server).delete(`/api/v1/events/guest-link/${link.token}`).expect(200);
      const cancelled = await prisma.event_guest_links.findFirst({ where: { id: link.id } });
      expect(cancelled!.cancelledAt).toBeTruthy();

      // Cancelling clears the "already used" block, so the link works again
      await request(server).post(`/api/v1/events/guest-link/${link.token}`).send({}).expect(201);
    });

    it('rejects cancelling an expired link', async () => {
      const event = await createPublishedEvent();
      const link = await prisma.event_guest_links.create({ data: {
        eventId: event.id,
        createdById: member.id,
        deliveryType: 'shareable',
        source: 'member',
        token: `expired-cancel-${Date.now()}`,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
      } });

      await request(server).delete(`/api/v1/events/guest-link/${link.token}`).expect(400);
    });

    it('allows cancelling the same link twice (idempotent)', async () => {
      const event = await createPublishedEvent();
      const link = await prisma.event_guest_links.create({ data: {
        eventId: event.id,
        createdById: member.id,
        deliveryType: 'shareable',
        source: 'member',
        token: `double-cancel-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      } });

      await request(server).delete(`/api/v1/events/guest-link/${link.token}`).expect(200);
      await request(server).delete(`/api/v1/events/guest-link/${link.token}`).expect(200);
    });
  });

  describe('POST /events/:id/public-rsvp (no auth)', () => {
    it('creates a public RSVP with a new guest-link row', async () => {
      const event = await createPublishedEvent();

      await request(server)
        .post(`/api/v1/events/${event.id}/public-rsvp`)
        .send({ name: 'Public Guest', email: 'public-rsvp@example.test' })
        .expect(201);

      const link = await prisma.event_guest_links
        .findFirst({ where: { eventId: event.id, recipientEmail: 'public-rsvp@example.test' } });
      expect(link).toBeTruthy();
      expect(link!.source).toBe('public');
      expect(link!.usedAt).toBeTruthy();
    });

    it('rejects a public RSVP for an unpublished event', async () => {
      const event = await createEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/public-rsvp`)
        .send({ name: 'Public Guest', email: 'nope@example.test' })
        .expect(400);
    });

    it('rejects a public RSVP for an email that already belongs to a member', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/public-rsvp`)
        .send({ name: 'Existing Member', email: 'member@example.test' })
        .expect(400);
    });

    it('rejects a duplicate public RSVP for the same email on the same event', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/public-rsvp`)
        .send({ name: 'Dup Guest', email: 'dup-public@example.test' })
        .expect(201);

      await request(server)
        .post(`/api/v1/events/${event.id}/public-rsvp`)
        .send({ name: 'Dup Guest', email: 'dup-public@example.test' })
        .expect(400);
    });

    it('rejects a payload missing required fields', async () => {
      const event = await createPublishedEvent();
      await request(server).post(`/api/v1/events/${event.id}/public-rsvp`).send({ name: 'No Email' }).expect(400);
    });
  });

  describe('Walk-ins: POST /events/:id/attendance/walkin', () => {
    it('creates a new attended Going RSVP for a member with no prior RSVP', async () => {
      const event = await createPublishedEvent();

      await request(server)
        .post(`/api/v1/events/${event.id}/attendance/walkin`)
        .set('Cookie', adminCookie)
        .send({ userId: member.id })
        .expect(201);

      const rsvp = await prisma.event_rsvps.findFirst({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp!.status).toBe(RsvpStatus.GOING);
      expect(rsvp!.attended).toBeTruthy();
      expect(rsvp!.isWalkin).toBeTruthy();

      const points = await prisma.member_points
        .findFirst({ where: { userId: member.id, pointType: PointType.ATTENDANCE, referenceId: event.id } });
      expect(points).toBeTruthy();
    });

    it('marks an existing non-Going RSVP as attended without changing its status', async () => {
      const event = await createPublishedEvent();
      await prisma.event_rsvps.create({ data: {
        eventId: event.id,
        userId: member.id,
        status: RsvpStatus.NOT_GOING,
      } });

      await request(server)
        .post(`/api/v1/events/${event.id}/attendance/walkin`)
        .set('Cookie', adminCookie)
        .send({ userId: member.id })
        .expect(201);

      const rsvp = await prisma.event_rsvps.findFirst({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp!.status).toBe(RsvpStatus.NOT_GOING);
      expect(rsvp!.attended).toBeTruthy();
      expect(rsvp!.isWalkin).toBeTruthy();
    });

    it('rejects a member walking someone in (mod/admin only)', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/attendance/walkin`)
        .set('Cookie', memberCookie)
        .send({ userId: member2.id })
        .expect(403);
    });

    it('returns 404 for a nonexistent user', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .post(`/api/v1/events/${event.id}/attendance/walkin`)
        .set('Cookie', adminCookie)
        .send({ userId: 999999 })
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      const event = await createPublishedEvent();
      await request(server).post(`/api/v1/events/${event.id}/attendance/walkin`).send({ userId: member.id }).expect(401);
    });
  });

  describe('GET /events/:id/members/search', () => {
    it('excludes a member already RSVP\'d Going by default (walk-in search — they\'re already on the list)', async () => {
      const event = await createPublishedEvent();
      await prisma.event_rsvps.create({ data: { eventId: event.id, userId: member.id, status: RsvpStatus.GOING } });

      const res = await request(server)
        .get(`/api/v1/events/${event.id}/members/search`)
        .query({ q: member.fullName })
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.some((m: { id: number }) => m.id === member.id)).toBe(false);
    });

    it('includes a member already RSVP\'d Going when excludeGoing=false (reservation-coordinator search — they often already are)', async () => {
      const event = await createPublishedEvent();
      await prisma.event_rsvps.create({ data: { eventId: event.id, userId: member.id, status: RsvpStatus.GOING } });

      const res = await request(server)
        .get(`/api/v1/events/${event.id}/members/search`)
        .query({ q: member.fullName, excludeGoing: 'false' })
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.some((m: { id: number }) => m.id === member.id)).toBe(true);
    });

    it('rejects a member searching (mod/admin only)', async () => {
      const event = await createPublishedEvent();
      await request(server)
        .get(`/api/v1/events/${event.id}/members/search`)
        .query({ q: 'a' })
        .set('Cookie', memberCookie)
        .expect(403);
    });

    it('rejects unauthenticated requests', async () => {
      const event = await createPublishedEvent();
      await request(server).get(`/api/v1/events/${event.id}/members/search`).query({ q: 'a' }).expect(401);
    });
  });

  describe('PATCH /events/:id/reservation', () => {
    it('retroactively awards a coordinator point when the assignee already attended the event', async () => {
      const event = await createPublishedEvent();
      // Back-date the location so awardCoordinator() gives the plain COORDINATOR
      // credit rather than the NEW_LOCATION_COORDINATOR bonus (see the similar
      // note on the "established location" test above).
      await prisma.locations.update({
        where: { id: location.id },
        data: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      });
      await prisma.event_rsvps.create({ data: {
        eventId: event.id,
        userId: member.id,
        status: RsvpStatus.GOING,
        attended: true,
      } });

      await request(server)
        .patch(`/api/v1/events/${event.id}/reservation`)
        .set('Cookie', adminCookie)
        .send({ assigneeId: member.id })
        .expect(200);

      const coordinatorPoints = await prisma.member_points
        .findFirst({ where: { userId: member.id, pointType: PointType.COORDINATOR, referenceId: event.id } });
      expect(coordinatorPoints).toBeTruthy();
    });

    it('does not award a coordinator point when the assignee has not attended yet', async () => {
      const event = await createPublishedEvent();
      await prisma.event_rsvps.create({ data: {
        eventId: event.id,
        userId: member.id,
        status: RsvpStatus.GOING,
      } });

      await request(server)
        .patch(`/api/v1/events/${event.id}/reservation`)
        .set('Cookie', adminCookie)
        .send({ assigneeId: member.id })
        .expect(200);

      const coordinatorPoints = await prisma.member_points
        .findFirst({ where: { userId: member.id, pointType: PointType.COORDINATOR, referenceId: event.id } });
      expect(coordinatorPoints).toBeFalsy();
    });
  });

  describe('GET/PATCH /events/:id/attendance', () => {
    it('lists Going RSVPs and non-cancelled guest links', async () => {
      const event = await createPublishedEvent();
      await prisma.event_rsvps.create({ data: { eventId: event.id, userId: member.id, status: RsvpStatus.GOING } });
      await prisma.event_guest_links.create({ data: {
        eventId: event.id,
        createdById: member.id,
        deliveryType: 'shareable',
        source: 'member',
        recipientName: 'A Guest',
        token: `attendance-list-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      } });

      const res = await request(server).get(`/api/v1/events/${event.id}/attendance`).set('Cookie', adminCookie).expect(200);
      expect(res.body.some((r: { type: string }) => r.type === 'member')).toBe(true);
      expect(res.body.some((r: { type: string }) => r.type === 'guest')).toBe(true);
    });

    it('returns attended as a real boolean, not a raw tinyint 0/1 (the admin attendance dialog highlights by strict === true/false)', async () => {
      const event = await createPublishedEvent();
      await prisma.event_rsvps.create({ data: { eventId: event.id, userId: member.id, status: RsvpStatus.GOING } });

      await request(server)
        .patch(`/api/v1/events/${event.id}/attendance`)
        .set('Cookie', adminCookie)
        .send({ attendances: [{ userId: member.id, attended: true }] })
        .expect(200);

      const res = await request(server).get(`/api/v1/events/${event.id}/attendance`).set('Cookie', adminCookie).expect(200);
      const entry = res.body.find((r: { userId: number }) => r.userId === member.id);
      expect(entry.attended).toBe(true);
    });

    it('marks a Going RSVP attended and awards an attendance point', async () => {
      const event = await createPublishedEvent();
      await prisma.event_rsvps.create({ data: { eventId: event.id, userId: member.id, status: RsvpStatus.GOING } });

      await request(server)
        .patch(`/api/v1/events/${event.id}/attendance`)
        .set('Cookie', adminCookie)
        .send({ attendances: [{ userId: member.id, attended: true }] })
        .expect(200);

      const rsvp = await prisma.event_rsvps.findFirst({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp!.attended).toBeTruthy();
      const points = await prisma.member_points
        .findFirst({ where: { userId: member.id, pointType: PointType.ATTENDANCE, referenceId: event.id } });
      expect(points).toBeTruthy();
    });

    it('silently no-ops marking attendance for a non-Going RSVP', async () => {
      const event = await createPublishedEvent();
      await prisma.event_rsvps.create({ data: { eventId: event.id, userId: member.id, status: RsvpStatus.MAYBE } });

      await request(server)
        .patch(`/api/v1/events/${event.id}/attendance`)
        .set('Cookie', adminCookie)
        .send({ attendances: [{ userId: member.id, attended: true }] })
        .expect(200);

      const rsvp = await prisma.event_rsvps.findFirst({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp!.attended).toBeNull();
    });

    it('awards a coordinator point when the attendee is the reservation assignee at an established location', async () => {
      const event = await createPublishedEvent();
      // awardCoordinator gives a bonus (NEW_LOCATION_COORDINATOR) instead of the base
      // COORDINATOR award when the location was added within the last week — back-date
      // it so this test exercises the plain "established location" coordinator credit.
      await prisma.locations.update({
        where: { id: location.id },
        data: { createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      });
      await prisma.events.update({ where: { id: event.id }, data: { reservationAssigneeId: member.id } });
      await prisma.event_rsvps.create({ data: { eventId: event.id, userId: member.id, status: RsvpStatus.GOING } });

      await request(server)
        .patch(`/api/v1/events/${event.id}/attendance`)
        .set('Cookie', adminCookie)
        .send({ attendances: [{ userId: member.id, attended: true }] })
        .expect(200);

      const coordinatorPoints = await prisma.member_points
        .findFirst({ where: { userId: member.id, pointType: PointType.COORDINATOR, referenceId: event.id } });
      expect(coordinatorPoints).toBeTruthy();
    });

    it('awards the new-location coordinator bonus when the location was added within the last week', async () => {
      const event = await createPublishedEvent();
      await prisma.events.update({ where: { id: event.id }, data: { reservationAssigneeId: member.id } });
      await prisma.event_rsvps.create({ data: { eventId: event.id, userId: member.id, status: RsvpStatus.GOING } });

      await request(server)
        .patch(`/api/v1/events/${event.id}/attendance`)
        .set('Cookie', adminCookie)
        .send({ attendances: [{ userId: member.id, attended: true }] })
        .expect(200);

      const newLocationPoints = await prisma.member_points
        .findFirst({ where: { userId: member.id, pointType: PointType.NEW_LOCATION_COORDINATOR, referenceId: event.id } });
      expect(newLocationPoints).toBeTruthy();
      expect(newLocationPoints!.points).toBe(4);
    });

    it('awards a city-hopper point when fromOtherCity is set', async () => {
      const event = await createPublishedEvent();
      await prisma.event_rsvps.create({ data: { eventId: event.id, userId: member.id, status: RsvpStatus.GOING } });

      await request(server)
        .patch(`/api/v1/events/${event.id}/attendance`)
        .set('Cookie', adminCookie)
        .send({ attendances: [{ userId: member.id, attended: true, fromOtherCity: true }] })
        .expect(200);

      const cityHopperPoints = await prisma.member_points
        .findFirst({ where: { userId: member.id, pointType: PointType.CITY_HOPPER, referenceId: event.id } });
      expect(cityHopperPoints).toBeTruthy();
    });

    it('awards a secret-dinner point when the event isSecret', async () => {
      const event = await createPublishedEvent({ isSecret: true });
      await prisma.event_rsvps.create({ data: { eventId: event.id, userId: member.id, status: RsvpStatus.GOING } });

      await request(server)
        .patch(`/api/v1/events/${event.id}/attendance`)
        .set('Cookie', adminCookie)
        .send({ attendances: [{ userId: member.id, attended: true }] })
        .expect(200);

      const secretDinnerPoints = await prisma.member_points
        .findFirst({ where: { userId: member.id, pointType: PointType.SECRET_DINNER, referenceId: event.id } });
      expect(secretDinnerPoints).toBeTruthy();
    });

    it('rejects a member reading or marking attendance (mod/admin only)', async () => {
      const event = await createPublishedEvent();
      await request(server).get(`/api/v1/events/${event.id}/attendance`).set('Cookie', memberCookie).expect(403);
      await request(server)
        .patch(`/api/v1/events/${event.id}/attendance`)
        .set('Cookie', memberCookie)
        .send({ attendances: [] })
        .expect(403);
    });
  });

  describe('Guest attendance + resend', () => {
    it('marks guest attendance', async () => {
      const event = await createPublishedEvent();
      const link = await prisma.event_guest_links.create({ data: {
        eventId: event.id,
        createdById: member.id,
        deliveryType: 'shareable',
        source: 'member',
        token: `guest-attendance-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      } });

      await request(server)
        .patch(`/api/v1/events/guest-links/${link.id}/attendance`)
        .set('Cookie', adminCookie)
        .send({ attended: true })
        .expect(200);

      const updated = await prisma.event_guest_links.findFirst({ where: { id: link.id } });
      expect(updated!.attended).toBeTruthy();
    });

    it('rejects resending an invite with no recipient email', async () => {
      const event = await createPublishedEvent();
      const link = await prisma.event_guest_links.create({ data: {
        eventId: event.id,
        createdById: member.id,
        deliveryType: 'shareable',
        source: 'member',
        token: `no-email-resend-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      } });

      await request(server).post(`/api/v1/events/guest-links/${link.id}/resend`).set('Cookie', adminCookie).expect(400);
    });

    it('rejects a member marking guest attendance or resending (mod/admin only)', async () => {
      const event = await createPublishedEvent();
      const link = await prisma.event_guest_links.create({ data: {
        eventId: event.id,
        createdById: member.id,
        deliveryType: 'shareable',
        source: 'member',
        token: `guest-guard-${Date.now()}`,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      } });

      await request(server)
        .patch(`/api/v1/events/guest-links/${link.id}/attendance`)
        .set('Cookie', memberCookie)
        .send({ attended: true })
        .expect(403);
      await request(server).post(`/api/v1/events/guest-links/${link.id}/resend`).set('Cookie', memberCookie).expect(403);
    });
  });
});
