import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { CalendarService, IcsEventLike } from '../src/modules/calendar/calendar.service';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City, event_rsvps as EventRsvp, events as Event, locations as Location, users as User } from '@prisma/client';
import { EventStatus, RsvpStatus, UserRole } from '../src/database/enums';
import { toDateColumn, toTimeColumn } from '../src/common/utils/prisma-date.util';

const CLOUDFLARE_SECRET = 'test-cloudflare-email-secret-not-for-real-use';

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('Calendar / ICS Feed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let calendarService: CalendarService;

  let city: City;
  let location: Location;
  let admin: User;
  let member: User;
  let memberCookie: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
    calendarService = app.get(CalendarService);
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
    memberCookie = await loginAs(app, member);
  });

  async function seedEvent(overrides: Record<string, unknown> = {}): Promise<Event> {
    return prisma.events.create({ data: {
        cityId: city.id,
        locationId: location.id,
        locationName: location.name,
        locationAddress: location.address,
        createdById: admin.id,
        title: 'Calendar Test Dinner',
        status: EventStatus.PUBLISHED,
        ...overrides,
        // DATE and TIME columns are Date objects under Prisma, where the entities
        // typed them as strings. Specs still express them as 'YYYY-MM-DD' /
        // 'HH:MM' (the same shape the API accepts), so convert on the way in and
        // apply after the overrides spread so an override string converts too.
        eventDate: toDateColumn((overrides.eventDate as string) ?? dateOffset(14)),
        eventTime: toTimeColumn((overrides.eventTime as string) ?? '18:30'),
      }, });
  }

  describe('GET /calendar/feed.ics', () => {
    it('rejects a request with no token', async () => {
      await request(server).get('/api/v1/calendar/feed.ics').expect(401);
    });

    it('rejects an unknown token', async () => {
      await request(server).get('/api/v1/calendar/feed.ics').query({ token: 'nonexistent-token' }).expect(401);
    });

    it('returns a valid RFC 5545 feed with an upcoming published event', async () => {
      const event = await seedEvent();
      const token = await calendarService.getOrCreateToken(member.id);

      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);
      expect(res.headers['content-type']).toContain('text/calendar');
      expect(res.text).toContain('BEGIN:VCALENDAR');
      expect(res.text).toContain(`UID:dinnerbears-event-${event.id}@dinnerbears.com`);
      expect(res.text).toMatch(/DTSTART:\d{8}T\d{6}Z/);
      expect(res.text).toContain('STATUS:CONFIRMED');
      // calendar@<BASE_DOMAIN>; setup-env.ts pins BASE_DOMAIN=localhost. The old
      // literal named the production domain and could never match here.
      expect(res.text).toContain('ORGANIZER;CN=DinnerBears:mailto:calendar@localhost');
      expect(res.text).toContain('METHOD:PUBLISH');
    });

    it('returns the empty-feed skeleton when there are no matching events', async () => {
      const token = await calendarService.getOrCreateToken(member.id);

      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);
      expect(res.text).not.toContain('BEGIN:VEVENT');
      expect(res.text).not.toContain('X-WR-TIMEZONE');
    });

    it('excludes a cancelled event older than the 7-day grace window', async () => {
      await seedEvent({ status: EventStatus.CANCELLED, eventDate: dateOffset(-8) });
      const token = await calendarService.getOrCreateToken(member.id);

      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);
      expect(res.text).not.toContain('BEGIN:VEVENT');
    });

    it('includes a cancelled event still within the 7-day grace window', async () => {
      const event = await seedEvent({ status: EventStatus.CANCELLED, eventDate: dateOffset(-6) });
      const token = await calendarService.getOrCreateToken(member.id);

      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);
      expect(res.text).toContain(`UID:dinnerbears-event-${event.id}@dinnerbears.com`);
      expect(res.text).toContain('STATUS:CANCELLED');
      expect(res.text).toContain('[CANCELLED]');
    });

    it('folds a line longer than 75 octets', async () => {
      const longName = 'A'.repeat(120) + ' Location';
      await seedEvent({ locationName: longName });
      const token = await calendarService.getOrCreateToken(member.id);

      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);
      expect(res.text).toMatch(/SUMMARY:[^\r\n]*\r\n [^\r\n]+/);
    });

    it('rsvpOnly filters out events the member has not RSVPd to', async () => {
      const rsvpEvent = await seedEvent({ title: 'RSVPd Event' });
      await seedEvent({ title: 'Not RSVPd Event' });
      await prisma.event_rsvps.create({ data: { eventId: rsvpEvent.id, userId: member.id, status: RsvpStatus.GOING } });
      await prisma.users.update({ where: { id: member.id }, data: { calendarRsvpOnly: true } });

      const token = await calendarService.getOrCreateToken(member.id);
      calendarService.invalidateForUser(member.id);
      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);

      expect(res.text).toContain(`UID:dinnerbears-event-${rsvpEvent.id}@dinnerbears.com`);
      const matches = res.text.match(/BEGIN:VEVENT/g) ?? [];
      expect(matches).toHaveLength(1);
    });

    it('cityFilter restricts the feed to the member\'s own city', async () => {
      const otherCity = await seedCity(prisma);
      const otherLocation = await seedLocation(prisma, otherCity.id);
      const otherCityEvent = await prisma.events.create({ data: {
          cityId: otherCity.id,
          locationId: otherLocation.id,
          locationName: otherLocation.name,
          locationAddress: otherLocation.address,
          createdById: admin.id,
          title: 'Other City Dinner',
          eventDate: toDateColumn(dateOffset(14)),
          eventTime: toTimeColumn('18:30'),
          status: EventStatus.PUBLISHED,
        }, });
      await seedEvent({ title: 'My City Dinner' });
      await prisma.users.update({ where: { id: member.id }, data: { calendarCityFilter: 'city' } });

      const token = await calendarService.getOrCreateToken(member.id);
      calendarService.invalidateForUser(member.id);
      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);

      expect(res.text).not.toContain(`UID:dinnerbears-event-${otherCityEvent.id}@dinnerbears.com`);
    });
  });

  describe('GET/PATCH /calendar/settings', () => {
    it('returns default settings with a feed URL', async () => {
      const res = await request(server).get('/api/v1/calendar/settings').set('Cookie', memberCookie).expect(200);
      expect(res.body.cityFilter).toBe('all');
      expect(res.body.rsvpOnly).toBeFalsy();
      expect(res.body.url).toContain('/calendar/feed.ics?token=');
    });

    it('updates settings and invalidates the cached feed', async () => {
      await seedEvent();
      const token = await calendarService.getOrCreateToken(member.id);
      await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);

      await request(server)
        .patch('/api/v1/calendar/settings')
        .set('Cookie', memberCookie)
        .send({ rsvpOnly: true, cityFilter: 'city' })
        .expect(200);

      const updated = await prisma.users.findFirst({ where: { id: member.id } });
      expect(updated!.calendarRsvpOnly).toBeTruthy();
      expect(updated!.calendarCityFilter).toBe('city');

      // Cache should be invalidated — the event we RSVP'd to nothing for should now be filtered out
      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token }).expect(200);
      expect(res.text).not.toContain('BEGIN:VEVENT');
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/calendar/settings').expect(401);
      await request(server).patch('/api/v1/calendar/settings').send({}).expect(401);
    });
  });

  describe('GET /calendar/token + GET /calendar/token/regenerate', () => {
    it('creates a token on first access', async () => {
      const res = await request(server).get('/api/v1/calendar/token').set('Cookie', memberCookie).expect(200);
      expect(res.body.url).toContain('/calendar/feed.ics?token=');

      const user = await prisma.users.findFirst({ where: { id: member.id } });
      expect(user!.calendarToken).toBeTruthy();
    });

    it('regenerates the token, invalidating the old one', async () => {
      const oldToken = await calendarService.getOrCreateToken(member.id);
      await request(server).get('/api/v1/calendar/feed.ics').query({ token: oldToken }).expect(200);

      await request(server).get('/api/v1/calendar/token/regenerate').set('Cookie', memberCookie).expect(200);

      await request(server).get('/api/v1/calendar/feed.ics').query({ token: oldToken }).expect(401);

      const user = await prisma.users.findFirst({ where: { id: member.id } });
      const res = await request(server).get('/api/v1/calendar/feed.ics').query({ token: user!.calendarToken }).expect(200);
      expect(res.text).toContain('BEGIN:VCALENDAR');
    });

    it('rejects unauthenticated requests', async () => {
      await request(server).get('/api/v1/calendar/token').expect(401);
      await request(server).get('/api/v1/calendar/token/regenerate').expect(401);
    });
  });

  describe('POST /calendar/rsvp-reply', () => {
    function replyBody(eventId: number, partstat: string, email: string): string {
      return `BEGIN:VCALENDAR\r\nMETHOD:REPLY\r\nBEGIN:VEVENT\r\nUID:dinnerbears-event-${eventId}@dinnerbears.com\r\nATTENDEE;PARTSTAT=${partstat};CN=Reply Test:mailto:${email}\r\nEND:VEVENT\r\nEND:VCALENDAR`;
    }

    it('rejects a request with no secret header', async () => {
      await request(server).post('/api/v1/calendar/rsvp-reply').send({ raw: 'anything' }).expect(401);
    });

    it('rejects a request with the wrong secret', async () => {
      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', 'wrong-secret')
        .send({ raw: 'anything' })
        .expect(401);
    });

    it('accepts ACCEPTED and upserts a Going RSVP', async () => {
      const event = await seedEvent();

      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: replyBody(event.id, 'ACCEPTED', member.email) })
        .expect(200);

      const rsvp = await prisma.event_rsvps.findFirst({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp!.status).toBe(RsvpStatus.GOING);
    });

    it('maps TENTATIVE to Maybe and DECLINED to Not Going', async () => {
      const event = await seedEvent();

      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: replyBody(event.id, 'TENTATIVE', member.email) })
        .expect(200);
      let rsvp = await prisma.event_rsvps.findFirst({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp!.status).toBe(RsvpStatus.MAYBE);

      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: replyBody(event.id, 'DECLINED', member.email) })
        .expect(200);
      rsvp = await prisma.event_rsvps.findFirst({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp!.status).toBe(RsvpStatus.NOT_GOING);
    });

    it('ignores an unrecognized PARTSTAT without error', async () => {
      const event = await seedEvent();

      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: replyBody(event.id, 'NEEDS-ACTION', member.email) })
        .expect(200);

      const rsvp = await prisma.event_rsvps.findFirst({ where: { eventId: event.id, userId: member.id } });
      expect(rsvp).toBeNull();
    });

    it('ignores a reply for an event that is not published', async () => {
      const draftEvent = await seedEvent({ status: EventStatus.DRAFT });

      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: replyBody(draftEvent.id, 'ACCEPTED', member.email) })
        .expect(200);

      const rsvp = await prisma.event_rsvps.findFirst({ where: { eventId: draftEvent.id, userId: member.id } });
      expect(rsvp).toBeNull();
    });

    it('ignores a reply from an email with no matching user', async () => {
      const event = await seedEvent();

      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: replyBody(event.id, 'ACCEPTED', 'nobody@example.test') })
        .expect(200);

      const count = await prisma.event_rsvps.count({ where: { eventId: event.id } });
      expect(count).toBe(0);
    });

    it('ignores a malformed body with no iCal block', async () => {
      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ raw: 'not an ical email at all' })
        .expect(200);
    });
  });

  describe('CalendarService.buildInviteAttachment (Phase 16b — direct call, no HTTP side effect to observe)', () => {
    it('builds a METHOD:REQUEST invite with an ATTENDEE RSVP line and a DTSTAMP', async () => {
      const event: IcsEventLike = {
        id: 1,
        title: 'Test Dinner',
        status: EventStatus.PUBLISHED,
        locationName: 'Test Place',
        locationAddress: '123 Main St',
        eventDate: dateOffset(14),
        eventTime: '18:30',
        updatedAt: new Date(),
      };

      const ics = await calendarService.buildInviteAttachment(
        event,
        { name: 'Guest Name', email: 'guest@example.test' },
        'http://localhost:8081',
      );

      expect(ics).toContain('METHOD:REQUEST');
      expect(ics).toContain(`UID:dinnerbears-event-${event.id}@dinnerbears.com`);
      expect(ics).toContain('ATTENDEE;CN=Guest Name;RSVP=TRUE:mailto:guest@example.test');
      // calendar@<BASE_DOMAIN>, and setup-env.ts pins BASE_DOMAIN=localhost.
      // The old literal named the production domain; the assertion never ran,
      // because this call was not awaited and the Promise silently passed the
      // earlier toContain checks.
      expect(ics).toContain('ORGANIZER;CN=DinnerBears:mailto:calendar@localhost');
      expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    });

    it('increments SEQUENCE on a repeat send for the same event, even when the event itself is unchanged', async () => {
      // Regression test: SEQUENCE used to be derived from event.updatedAt, so
      // re-confirming the same RSVP (toggling away and back to Going) resent
      // the exact same SEQUENCE every time — calendar clients had no signal
      // that a later email superseded an earlier one and created a duplicate
      // pending invitation per message instead of updating one in place.
      const event: IcsEventLike = {
        id: 2,
        title: 'Test Dinner',
        status: EventStatus.PUBLISHED,
        locationName: 'Test Place',
        locationAddress: '123 Main St',
        eventDate: dateOffset(14),
        eventTime: '18:30',
        updatedAt: new Date(),
      };
      const recipient = { name: 'Guest Name', email: 'guest@example.test' };

      const first = await calendarService.buildInviteAttachment(event, recipient, 'http://localhost:8081');
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const second = await calendarService.buildInviteAttachment(event, recipient, 'http://localhost:8081');

      const extractSequence = (ics: string) => Number(ics.match(/SEQUENCE:(\d+)/)?.[1]);
      expect(extractSequence(second)).toBeGreaterThan(extractSequence(first));
    });
  });
});
