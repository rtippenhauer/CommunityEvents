import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  truncateAllTables,
  resetThrottler,
  TEST_TENANT_DOMAIN,
} from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { runWithTenant } from '../src/common/tenant/tenant-store';
import { EventStatus, RsvpSource, RsvpStatus, UserRole, UserStatus } from '../src/database/enums';
import { toDateColumn, toTimeColumn } from '../src/common/utils/prisma-date.util';
import { TEST_TENANT_ID } from './setup-env';
import type { cities as City, locations as LocationRow, users as User } from '@prisma/client';

const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithTenant(TEST_TENANT_ID, async () => await fn());

const dateOffset = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * The Facebook Going-list sync (v2-29), rules 1 to 14.
 *
 * Driven entirely over HTTP with a real Muse token, because the rules are about
 * what the integration can and cannot do -- and because the guard, the
 * token-to-tenant middleware and the sync have to agree. A test that called the
 * service directly would skip the two things most likely to be wrong.
 *
 * The rules that matter most here are the ones about **not** doing things: the
 * sync may never remove an RSVP a member made, never touch their own guest
 * list, and never count a banned member. Those are the cases where a bug is
 * invisible until somebody is missing from a dinner.
 */
describe('Facebook sync (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let city: City;
  let location: LocationRow;
  let admin: User;
  let adminCookie: string;
  let museToken: string;
  let museUserId: number;

  const FB_CINCY = '1617936020344888';
  const FB_GEM = '1072447435694919';

  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
    prisma = created.prisma;
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
    admin = await seedUser(prisma, city.id, {
      role: UserRole.ADMIN,
      email: 'admin@example.test',
    });
    adminCookie = await inTenant(() => loginAs(app, admin));

    const account = await request(server)
      .post('/api/v1/admin/integrations')
      .set('Host', TEST_TENANT_DOMAIN)
      .set('Cookie', adminCookie)
      .send({ name: 'Muse' })
      .expect(201);
    museUserId = account.body.id;

    const issued = await request(server)
      .post(`/api/v1/admin/integrations/${museUserId}/tokens`)
      .set('Host', TEST_TENANT_DOMAIN)
      .set('Cookie', adminCookie)
      .expect(201);
    museToken = issued.body.token;
  });

  const seedEvent = (overrides: Record<string, unknown> = {}) =>
    inTenant(() =>
      prisma.events.create({
        data: {
          cityId: city.id,
          locationId: location.id,
          locationName: location.name,
          locationAddress: location.address,
          createdById: admin.id,
          title: 'Sync Test Dinner',
          status: EventStatus.PUBLISHED,
          ...overrides,
          eventDate: toDateColumn((overrides.eventDate as string) ?? dateOffset(14)),
          eventTime: toTimeColumn((overrides.eventTime as string) ?? '18:30'),
        },
      }),
    );

  /** A guest as Muse sends them. */
  const guest = (
    name: string,
    id: string,
    extra: { plus_one_names?: string[]; plus_ones?: number } = {},
  ) => ({
    name,
    profile_url: `https://www.facebook.com/${id}`,
    facebook_user_id: id,
    ...extra,
  });

  const sync = (body: object, expected = 200) =>
    request(server)
      .post('/api/v1/muse/facebook-sync')
      .set('Host', TEST_TENANT_DOMAIN)
      .set('Authorization', `Bearer ${museToken}`)
      .send(body)
      .expect(expected);

  const rsvpFor = (eventId: number, userId: number) =>
    inTenant(() => prisma.event_rsvps.findFirst({ where: { eventId, userId } }));

  describe('linking (rule 2)', () => {
    it('links a Facebook event to its dinner on first sight', async () => {
      const event = await seedEvent();

      const res = await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            facebook_group: 'Cincinnati Tuesday Night Bear Dinners',
            guests: [],
          },
        ],
      });

      expect(res.body.events[0].status).toBe('ok');

      const link = await inTenant(() =>
        prisma.event_facebook_links.findFirst({ where: { facebookEventId: FB_CINCY } }),
      );
      expect(link?.eventId).toBe(event.id);
      expect(link?.facebookGroup).toBe('Cincinnati Tuesday Night Bear Dinners');
    });

    it('refuses to re-point a Facebook event at a different dinner', async () => {
      const first = await seedEvent();
      const second = await seedEvent({ title: 'Another Dinner' });

      await sync({
        events: [{ dinnerbears_event_id: first.id, facebook_event_id: FB_CINCY, guests: [] }],
      });

      const res = await sync({
        events: [{ dinnerbears_event_id: second.id, facebook_event_id: FB_CINCY, guests: [] }],
      });

      expect(res.body.events[0].status).toBe('error');
      expect(res.body.events[0].error).toContain(`already linked to event ${first.id}`);
    });

    it('refuses a draft and a past dinner', async () => {
      const draft = await seedEvent({ status: EventStatus.DRAFT });
      const past = await seedEvent({ eventDate: dateOffset(-3) });

      const res = await sync({
        events: [
          { dinnerbears_event_id: draft.id, facebook_event_id: FB_CINCY, guests: [] },
          { dinnerbears_event_id: past.id, facebook_event_id: FB_GEM, guests: [] },
        ],
      });

      expect(res.body.events[0].error).toContain('not published');
      expect(res.body.events[1].error).toContain('past');
    });

    it('does not stop the batch when one Facebook event fails (rule 12)', async () => {
      const good = await seedEvent();

      const res = await sync({
        events: [
          { dinnerbears_event_id: 999999, facebook_event_id: FB_CINCY, guests: [] },
          { dinnerbears_event_id: good.id, facebook_event_id: FB_GEM, guests: [] },
        ],
      });

      expect(res.body.events[0].status).toBe('error');
      expect(res.body.events[1].status).toBe('ok');
    });
  });

  describe('people seen (rules 4, 5)', () => {
    it('records a Facebook person and never links them automatically', async () => {
      const event = await seedEvent();
      // A member with the identical name -- the strongest possible temptation
      // to auto-link, and the one the rule exists to refuse.
      const twin = await seedUser(prisma, city.id, {
        fullName: 'Don Weaver',
        email: 'don@example.test',
      });

      const res = await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Don Weaver', '100000000000002')],
          },
        ],
      });

      const account = await inTenant(() =>
        prisma.facebook_accounts.findFirst({ where: { facebookUserId: '100000000000002' } }),
      );
      expect(account?.userId).toBeNull();
      expect(account?.status).toBe('unmatched');

      // Offered as a suggestion only.
      expect(res.body.unmatched[0].suggestions).toEqual([
        { id: twin.id, fullName: 'Don Weaver' },
      ]);
      expect(await rsvpFor(event.id, twin.id)).toBeNull();
    });

    it('keeps the numeric id as the key and refreshes a changed vanity URL', async () => {
      const event = await seedEvent();

      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Don Weaver', '100000000000002')],
          },
        ],
      });

      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [
              {
                name: 'Don Weaver',
                profile_url: 'https://www.facebook.com/don.weaver.new',
                facebook_user_id: '100000000000002',
              },
            ],
          },
        ],
      });

      const accounts = await inTenant(() =>
        prisma.facebook_accounts.findMany({ where: { facebookUserId: '100000000000002' } }),
      );
      // One row, updated -- not a second person.
      expect(accounts).toHaveLength(1);
      expect(accounts[0].profileUrl).toBe('https://www.facebook.com/don.weaver.new');
    });

    it('releases a vanity URL to its new holder rather than failing', async () => {
      const event = await seedEvent();

      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('First Holder', '100000000000001')],
          },
        ],
      });

      // Somebody else now has that vanity. A unique index with no release
      // would fail the whole sync on an entirely normal Facebook rename.
      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [
              {
                name: 'Second Holder',
                profile_url: 'https://www.facebook.com/100000000000001',
                facebook_user_id: '100000000000009',
              },
            ],
          },
        ],
      });

      const first = await inTenant(() =>
        prisma.facebook_accounts.findFirst({ where: { facebookUserId: '100000000000001' } }),
      );
      const second = await inTenant(() =>
        prisma.facebook_accounts.findFirst({ where: { facebookUserId: '100000000000009' } }),
      );
      expect(first?.profileUrl).toBeNull();
      expect(second?.profileUrl).toBe('https://www.facebook.com/100000000000001');
    });
  });

  describe('linked members (rules 7, 8, 10)', () => {
    /** Links a Facebook person to a member through the admin screen. */
    const linkTo = async (facebookUserId: string, userId: number) => {
      const account = await inTenant(() =>
        prisma.facebook_accounts.findFirstOrThrow({ where: { facebookUserId } }),
      );
      await request(server)
        .post(`/api/v1/admin/facebook-accounts/${account.id}/link`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .send({ userId })
        // 200 now, not 204: linking carries over (rule 14) and returns what it
        // did, so the screen can say so.
        .expect(200);
      return account.id;
    };

    it('marks a linked member Going, with source facebook_sync', async () => {
      const event = await seedEvent();
      const member = await seedUser(prisma, city.id, { email: 'jane@example.test' });

      const payload = {
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Jane Doe', '100000000000005')],
          },
        ],
      };

      await sync(payload);
      await linkTo('100000000000005', member.id);

      // The RSVP exists as soon as the link is made -- rule 14 carries over
      // immediately rather than waiting for the next run, which may be a day
      // away and is driven from outside.
      const rsvp = await rsvpFor(event.id, member.id);
      expect(rsvp?.status).toBe(RsvpStatus.GOING);
      expect(rsvp?.source).toBe(RsvpSource.FACEBOOK_SYNC);

      // And the next sync does not add them a second time.
      const res = await sync(payload);
      expect(res.body.added).toEqual([]);
    });

    it('keeps Facebook +1s beside the website guests, never merged', async () => {
      const event = await seedEvent();
      const member = await seedUser(prisma, city.id, { email: 'bob@example.test' });

      await inTenant(() =>
        prisma.event_rsvps.create({
          data: {
            eventId: event.id,
            userId: member.id,
            status: RsvpStatus.GOING,
            source: RsvpSource.MEMBER,
            additionalGuests: 1,
            guestNames: ['Website Guest'],
          },
        }),
      );

      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Bob Brown', '100000000000008', { plus_one_names: ['Dan Jones'] })],
          },
        ],
      });
      await linkTo('100000000000008', member.id);
      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Bob Brown', '100000000000008', { plus_one_names: ['Dan Jones'] })],
          },
        ],
      });

      const rsvp = await rsvpFor(event.id, member.id);
      // The member's own entry is untouched...
      expect(rsvp?.additionalGuests).toBe(1);
      expect(rsvp?.guestNames).toEqual(['Website Guest']);
      // ...and the Facebook +1 sits beside it.
      expect(rsvp?.facebookGuestNames).toEqual(['Dan Jones']);
      expect(rsvp?.facebookGuestCount).toBe(1);
    });

    it('skips a Facebook +1 a named website guest already covers (rule 10)', async () => {
      const event = await seedEvent();
      const member = await seedUser(prisma, city.id, { email: 'pat@example.test' });

      await inTenant(() =>
        prisma.event_rsvps.create({
          data: {
            eventId: event.id,
            userId: member.id,
            status: RsvpStatus.GOING,
            source: RsvpSource.MEMBER,
            additionalGuests: 1,
            guestNames: ['Pat Lee'],
          },
        }),
      );

      const payload = {
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Sam Fox', '100000000000011', { plus_one_names: ['Pat Lee'] })],
          },
        ],
      };
      await sync(payload);
      await linkTo('100000000000011', member.id);
      await sync(payload);

      const rsvp = await rsvpFor(event.id, member.id);
      expect(rsvp?.facebookGuestCount).toBe(0);

      // Asserted through the API rather than on the column: nothing was ever
      // written, so the column is still NULL, and NULL and `[]` mean the same
      // thing here. What a consumer must see is an empty list, and the
      // member's own guest is untouched beside it.
      const res = await request(server)
        .get(`/api/v1/muse/events/${event.id}/attendees`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${museToken}`)
        .expect(200);

      const row = res.body.members.find((m: { userId: number }) => m.userId === member.id);
      expect(row.facebookGuests).toEqual([]);
      expect(row.guestNames).toEqual(['Pat Lee']);
      expect(res.body.totalGoing).toBe(2);
    });

    it('never removes an RSVP the member made (rule 8)', async () => {
      const event = await seedEvent();
      const member = await seedUser(prisma, city.id, { email: 'own@example.test' });

      await inTenant(() =>
        prisma.event_rsvps.create({
          data: {
            eventId: event.id,
            userId: member.id,
            status: RsvpStatus.GOING,
            source: RsvpSource.MEMBER,
            facebookGuestNames: ['Someone'],
            facebookGuestCount: 1,
          },
        }),
      );

      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            going_count: 0,
            guests: [],
          },
        ],
      });

      const rsvp = await rsvpFor(event.id, member.id);
      // Still Going, and only the Facebook +1s are gone.
      expect(rsvp).not.toBeNull();
      expect(rsvp?.status).toBe(RsvpStatus.GOING);
      expect(rsvp?.facebookGuestCount).toBe(0);
    });

    it('removes its own RSVP once the member is on no list', async () => {
      const event = await seedEvent();
      const member = await seedUser(prisma, city.id, { email: 'gone@example.test' });

      const present = {
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Carl Carter', '100000000000012')],
          },
        ],
      };
      await sync(present);
      await linkTo('100000000000012', member.id);
      await sync(present);
      expect(await rsvpFor(event.id, member.id)).not.toBeNull();

      const res = await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            going_count: 0,
            guests: [],
          },
        ],
      });

      expect(await rsvpFor(event.id, member.id)).toBeNull();
      expect(res.body.removed).toEqual([
        expect.objectContaining({ userId: member.id, name: 'Test User' }),
      ]);
    });

    it('keeps somebody Going while any one of the dinner lists has them (rule 3)', async () => {
      const event = await seedEvent();
      const member = await seedUser(prisma, city.id, { email: 'two@example.test' });

      const both = {
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Steve Brack', '100000000000013')],
          },
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_GEM,
            guests: [guest('Steve Brack', '100000000000013')],
          },
        ],
      };
      await sync(both);
      await linkTo('100000000000013', member.id);
      await sync(both);

      // Dropped from Cincinnati, still on Gem City.
      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            going_count: 0,
            guests: [],
          },
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_GEM,
            guests: [guest('Steve Brack', '100000000000013')],
          },
        ],
      });

      expect(await rsvpFor(event.id, member.id)).not.toBeNull();
    });

    it('does not remove anybody when the list was partial (rule 12)', async () => {
      const event = await seedEvent();
      const member = await seedUser(prisma, city.id, { email: 'partial@example.test' });

      const present = {
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Partial Person', '100000000000014')],
          },
        ],
      };
      await sync(present);
      await linkTo('100000000000014', member.id);
      await sync(present);

      // going_count says 5 but one guest was sent: a truncated scrape.
      const res = await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            going_count: 5,
            guests: [],
          },
        ],
      });

      expect(res.body.events[0].complete).toBe(false);
      expect(res.body.warnings.join(' ')).toContain("going_count didn't match");
      // Nobody emptied the dinner.
      expect(await rsvpFor(event.id, member.id)).not.toBeNull();
    });

    it('never adds or counts a banned member (rule 13)', async () => {
      const event = await seedEvent();
      const banned = await seedUser(prisma, city.id, {
        email: 'banned@example.test',
        fullName: 'Banned Person',
      });

      const payload = {
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Banned Person', '100000000000015')],
          },
        ],
      };
      await sync(payload);

      // Banned BEFORE the link, which is the order that actually happens: an
      // admin linking somebody who is already banned. Banning afterwards is a
      // different question -- it does not retract RSVPs anywhere else in the
      // system either, and the headcount excludes them regardless.
      await inTenant(() =>
        prisma.users.updateMany({
          where: { id: banned.id },
          data: { status: UserStatus.SUSPENDED },
        }),
      );

      await linkTo('100000000000015', banned.id);

      const res = await sync(payload);

      expect(await rsvpFor(event.id, banned.id)).toBeNull();
      expect(res.body.warnings.join(' ')).toContain('Banned Person');
      // And they are not silently counted as a Facebook-only attendee either,
      // which is the mistake "unlinked means Facebook-only" would make.
      expect(res.body.events[0].totalGoing).toBe(0);
    });
  });

  describe('the headcount (rule 11)', () => {
    it('counts members, their guests, Facebook +1s and Facebook-only people', async () => {
      const event = await seedEvent();
      const member = await seedUser(prisma, city.id, { email: 'counted@example.test' });

      await inTenant(() =>
        prisma.event_rsvps.create({
          data: {
            eventId: event.id,
            userId: member.id,
            status: RsvpStatus.GOING,
            source: RsvpSource.MEMBER,
            additionalGuests: 2,
            guestNames: ['A', 'B'],
          },
        }),
      );

      const res = await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [
              guest('Don Weaver', '100000000000002', {
                plus_one_names: ['Pat Lee'],
                plus_ones: 2,
              }),
            ],
          },
        ],
      });

      // Member 1 + 2 website guests = 3.
      // Don Weaver 1 + 2 +1s (one named, one unnamed) = 3.
      expect(res.body.events[0].totalGoing).toBe(6);
    });

    it('counts a person on two lists once', async () => {
      const event = await seedEvent();

      const res = await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Twice Listed', '100000000000016')],
          },
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_GEM,
            guests: [guest('Twice Listed', '100000000000016')],
          },
        ],
      });

      expect(res.body.events[0].totalGoing).toBe(1);
      // Both Facebook events get the dinner's FINAL count, which is what Muse
      // writes into each description (rule 1).
      expect(res.body.events[1].totalGoing).toBe(1);
    });

    it('is reflected in the member-facing event list', async () => {
      const event = await seedEvent();

      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Facebook Only', '100000000000017', { plus_ones: 1 })],
          },
        ],
      });

      const res = await request(server)
        .get('/api/v1/events')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .expect(200);

      const listed = res.body.find((e: { id: number }) => e.id === event.id);
      // One Facebook-only person plus their unnamed +1.
      expect(listed.goingCount).toBe(2);
    });
  });

  describe('replay and idempotence', () => {
    it('skips a list read before the one already applied (rule 12)', async () => {
      const event = await seedEvent();

      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Current', '100000000000018')],
          },
        ],
        extracted_at: '2026-10-20T10:00:00.000Z',
      });

      const res = await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            going_count: 0,
            guests: [],
          },
        ],
        extracted_at: '2026-10-20T09:00:00.000Z',
      });

      expect(res.body.events[0].status).toBe('skipped');
      // The stale read changed nothing.
      const attendees = await inTenant(() =>
        prisma.facebook_event_attendees.findMany({ where: { eventId: event.id } }),
      );
      expect(attendees).toHaveLength(1);
    });

    it('is idempotent when the same list is sent twice', async () => {
      const event = await seedEvent();
      const payload = {
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Same Person', '100000000000019', { plus_ones: 1 })],
          },
        ],
      };

      const first = await sync(payload);
      const second = await sync(payload);

      expect(second.body.events[0].totalGoing).toBe(first.body.events[0].totalGoing);
      expect(second.body.guestsChanged).toEqual([]);

      const attendees = await inTenant(() =>
        prisma.facebook_event_attendees.findMany({ where: { eventId: event.id } }),
      );
      expect(attendees).toHaveLength(1);
    });

    it('accepts and ignores the informational fields', async () => {
      const event = await seedEvent();

      // `title`, `facebook_event_url` and `note` are documented as accepted and
      // ignored. A 400 over an extra field would stop a whole run.
      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            title: 'Wednesday Night Bears',
            facebook_event_url: `https://www.facebook.com/events/${FB_CINCY}/`,
            guests: [],
          },
        ],
        note: 'nightly run',
      });
    });

    it('rejects a non-numeric Facebook event id', async () => {
      const event = await seedEvent();
      await sync(
        {
          events: [
            {
              dinnerbears_event_id: event.id,
              facebook_event_id: 'not-digits',
              guests: [],
            },
          ],
        },
        400,
      );
    });
  });

  describe('unlinking a Facebook event', () => {
    it('drops that list and stops counting anybody who was only on it', async () => {
      const event = await seedEvent();

      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Only Here', '100000000000020')],
          },
        ],
      });

      await request(server)
        .delete(`/api/v1/muse/events/${event.id}/facebook-events/${FB_CINCY}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${museToken}`)
        .expect(200);

      const attendees = await inTenant(() =>
        prisma.facebook_event_attendees.findMany({ where: { eventId: event.id } }),
      );
      expect(attendees).toHaveLength(0);

      const res = await request(server)
        .get(`/api/v1/muse/events/${event.id}/attendees`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Authorization', `Bearer ${museToken}`)
        .expect(200);
      expect(res.body.totalGoing).toBe(0);
    });
  });

  describe('tenant isolation', () => {
    it('refuses a sync naming another community event', async () => {
      // The other community's event id does not resolve from here at all,
      // because every read is scoped -- so this is an ordinary "no such event"
      // rather than a cross-tenant write.
      const otherTenantId = await runWithTenant(TEST_TENANT_ID, async () => TEST_TENANT_ID);
      expect(otherTenantId).toBe(TEST_TENANT_ID);

      const res = await sync({
        events: [{ dinnerbears_event_id: 987654, facebook_event_id: FB_CINCY, guests: [] }],
      });
      expect(res.body.events[0].status).toBe('error');
      expect(res.body.events[0].error).toContain('No such event');
    });
  });

  describe('cancelled guest links (Rob, 2026-10-23)', () => {
    it('stops counting a guest who cancelled, so both totals agree', async () => {
      const event = await seedEvent();
      const member = await seedUser(prisma, city.id, { email: 'cancelled@example.test' });

      const rsvp = await inTenant(() =>
        prisma.event_rsvps.create({
          data: {
            eventId: event.id,
            userId: member.id,
            status: RsvpStatus.GOING,
            source: RsvpSource.MEMBER,
            additionalGuests: 2,
            guestNames: ['Coming', 'Cancelling'],
          },
        }),
      );

      // One of the two guests cancels their link.
      await inTenant(() =>
        prisma.event_guest_links.create({
          data: {
            eventId: event.id,
            memberRsvpId: rsvp.id,
            createdById: member.id,
            token: 'cancelled-link-token',
            expiresAt: new Date(Date.now() + 86_400_000),
            cancelledAt: new Date(),
            recipientName: 'Cancelling',
          },
        }),
      );

      const res = await sync({
        events: [
          { dinnerbears_event_id: event.id, facebook_event_id: FB_CINCY, guests: [] },
        ],
      });

      // The member plus the one guest still coming -- not two.
      expect(res.body.events[0].totalGoing).toBe(2);

      // And the event list agrees, which is the whole point: these are the
      // same claim about the same dinner.
      const list = await request(server)
        .get('/api/v1/events')
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .expect(200);
      expect(list.body.find((e: { id: number }) => e.id === event.id).goingCount).toBe(2);
    });

    it('never counts a member below one, however many links cancelled', async () => {
      const event = await seedEvent();
      const member = await seedUser(prisma, city.id, { email: 'overcancelled@example.test' });

      const rsvp = await inTenant(() =>
        prisma.event_rsvps.create({
          data: {
            eventId: event.id,
            userId: member.id,
            status: RsvpStatus.GOING,
            source: RsvpSource.MEMBER,
            additionalGuests: 0,
          },
        }),
      );

      // Inconsistent data: a cancelled link with no guest to match it.
      await inTenant(() =>
        prisma.event_guest_links.create({
          data: {
            eventId: event.id,
            memberRsvpId: rsvp.id,
            createdById: member.id,
            token: 'stray-cancelled-token',
            expiresAt: new Date(Date.now() + 86_400_000),
            cancelledAt: new Date(),
          },
        }),
      );

      const res = await sync({
        events: [
          { dinnerbears_event_id: event.id, facebook_event_id: FB_CINCY, guests: [] },
        ],
      });

      // The member is still at the table, not subtracted out of existence.
      expect(res.body.events[0].totalGoing).toBe(1);
    });
  });

  describe('linking carries over immediately (rule 14)', () => {
    const linkAccount = async (facebookUserId: string, userId: number) => {
      const account = await inTenant(() =>
        prisma.facebook_accounts.findFirstOrThrow({ where: { facebookUserId } }),
      );
      const res = await request(server)
        .post(`/api/v1/admin/facebook-accounts/${account.id}/link`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .send({ userId })
        .expect(200);
      return res.body;
    };

    it('turns an upcoming Going list into an RSVP without waiting for a sync', async () => {
      const event = await seedEvent();
      const member = await seedUser(prisma, city.id, { email: 'carry@example.test' });

      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Carry Over', '100000000000030', { plus_one_names: ['Plus One'] })],
          },
        ],
      });

      expect(await rsvpFor(event.id, member.id)).toBeNull();

      const result = await linkAccount('100000000000030', member.id);

      // No second sync -- the link alone did it.
      const rsvp = await rsvpFor(event.id, member.id);
      expect(rsvp?.status).toBe(RsvpStatus.GOING);
      expect(rsvp?.source).toBe(RsvpSource.FACEBOOK_SYNC);
      expect(rsvp?.facebookGuestCount).toBe(1);
      expect(result.upcoming).toBe(1);
    });

    it('credits a past attendance with points, through the normal path', async () => {
      const past = await seedEvent({ eventDate: dateOffset(-7), title: 'Last Week' });
      const member = await seedUser(prisma, city.id, { email: 'past@example.test' });

      // Seed the Facebook-only attendance directly: the sync refuses a past
      // event, which is exactly why this history exists only as an attendee row.
      const account = await inTenant(() =>
        prisma.facebook_accounts.create({
          data: {
            facebookUserId: '100000000000031',
            profileUrl: 'https://www.facebook.com/past.person',
            displayName: 'Past Person',
          },
        }),
      );
      await inTenant(() =>
        prisma.facebook_event_attendees.create({
          data: {
            eventId: past.id,
            facebookAccountId: account.id,
            sources: { [FB_CINCY]: { names: [], total: 0 } },
            attended: true,
          },
        }),
      );

      const result = await linkAccount('100000000000031', member.id);

      const rsvp = await rsvpFor(past.id, member.id);
      expect(rsvp?.attended).toBe(true);
      expect(result.attended).toBe(1);

      // The normal attendance path ran, so the points landed.
      const points = await inTenant(() =>
        prisma.member_points.findMany({ where: { userId: member.id, referenceId: past.id } }),
      );
      expect(points.length).toBeGreaterThan(0);
    });

    it('does not credit a past dinner nobody marked them present at', async () => {
      const past = await seedEvent({ eventDate: dateOffset(-7), title: 'Unmarked' });
      const member = await seedUser(prisma, city.id, { email: 'unmarked@example.test' });

      const account = await inTenant(() =>
        prisma.facebook_accounts.create({
          data: {
            facebookUserId: '100000000000032',
            profileUrl: 'https://www.facebook.com/unmarked.person',
            displayName: 'Unmarked Person',
          },
        }),
      );
      await inTenant(() =>
        prisma.facebook_event_attendees.create({
          data: {
            eventId: past.id,
            facebookAccountId: account.id,
            sources: { [FB_CINCY]: { names: [], total: 0 } },
            // NULL: "not marked", which is not the same as "did not come" --
            // and earns nothing either way.
            attended: null,
          },
        }),
      );

      const result = await linkAccount('100000000000032', member.id);

      expect(await rsvpFor(past.id, member.id)).toBeNull();
      expect(result.attended).toBe(0);
    });

    it('does not double-credit a member already marked attended', async () => {
      const past = await seedEvent({ eventDate: dateOffset(-7), title: 'Already Credited' });
      const member = await seedUser(prisma, city.id, { email: 'already@example.test' });

      await inTenant(() =>
        prisma.event_rsvps.create({
          data: {
            eventId: past.id,
            userId: member.id,
            status: RsvpStatus.GOING,
            source: RsvpSource.MEMBER,
            attended: true,
          },
        }),
      );
      const before = await inTenant(() =>
        prisma.member_points.count({ where: { userId: member.id, referenceId: past.id } }),
      );

      const account = await inTenant(() =>
        prisma.facebook_accounts.create({
          data: {
            facebookUserId: '100000000000033',
            profileUrl: 'https://www.facebook.com/already.person',
            displayName: 'Already Person',
          },
        }),
      );
      await inTenant(() =>
        prisma.facebook_event_attendees.create({
          data: {
            eventId: past.id,
            facebookAccountId: account.id,
            sources: { [FB_CINCY]: { names: [], total: 0 } },
            attended: true,
          },
        }),
      );

      const result = await linkAccount('100000000000033', member.id);

      const after = await inTenant(() =>
        prisma.member_points.count({ where: { userId: member.id, referenceId: past.id } }),
      );
      expect(after).toBe(before);
      expect(result.attended).toBe(0);
    });

    it('carries over nothing for a banned member', async () => {
      const event = await seedEvent();
      const banned = await seedUser(prisma, city.id, {
        email: 'bannedlink@example.test',
        status: UserStatus.SUSPENDED,
      });

      await sync({
        events: [
          {
            dinnerbears_event_id: event.id,
            facebook_event_id: FB_CINCY,
            guests: [guest('Banned Link', '100000000000034')],
          },
        ],
      });

      const result = await linkAccount('100000000000034', banned.id);

      expect(await rsvpFor(event.id, banned.id)).toBeNull();
      expect(result).toEqual({ upcoming: 0, attended: 0 });
    });
  });
});

