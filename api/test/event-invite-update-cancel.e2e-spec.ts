import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { EventsService } from '../src/modules/events/events.service';
import { BrevoService } from '../src/modules/email/brevo.service';
import { runWithTenant } from '../src/common/tenant/tenant-store';
import { createTestApp, truncateAllTables } from './utils/test-app';
import { seedCity, seedLocation, seedUser } from './utils/seed';
import { TEST_TENANT_ID } from './setup-env';
import { EventStatus, RsvpStatus, UserRole } from '../src/database/enums';
import { unfoldIcs } from '../src/common/utils/ics.util';
import type { cities as City, locations as Location } from '@prisma/client';

/**
 * Moving and cancelling the calendar entry an invite created (`v2-50`).
 *
 * Reported from v1 production: a dinner moved from Tue Dec 1 to Wed Dec 2
 * stayed on Tuesday in members' calendars. The website moved; nothing else
 * did. Pressing resync did not help and actively misled, because resync
 * refreshes the *subscribed feed* -- a different entry from the one the invite
 * email created -- so the member sees one entry correct and concludes the
 * calendar is fine.
 *
 * Three things are asserted per recipient group, and the third is the one that
 * fails loudest if the plumbing regresses:
 *
 * 1. RSVP holders, who already received the notice, now receive an `.ics`.
 * 2. **Auto-invited members who never answered**, who received nothing at all
 *    -- the worst case, since they hold an entry and were told nothing.
 * 3. That the attachment survives the queue. Before this item `queue()` took
 *    `attachments` on its DTO and dropped them, with no column to put them in,
 *    so every assertion above could pass against a send that carried nothing.
 */
describe('Invite update and cancellation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let events: EventsService;

  let city: City;
  let location: Location;
  let adminId: number;

  const inTenant = <T>(fn: () => Promise<T>): Promise<T> =>
    runWithTenant(TEST_TENANT_ID, async () => await fn());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    events = app.get(EventsService);

    // The provider is stubbed because these tests are about what we compose,
    // not about Brevo. It matters more than usual here: `sendPublishInvites`
    // uses `sendNow`, whose failure path falls back to the queue -- so an
    // unstubbed provider would leave rows that look like the ones under test.
    const brevo = app.get(BrevoService);
    (brevo as unknown as { send: (dto: unknown) => Promise<{ messageId: null }> }).send =
      async () => ({ messageId: null });
    (brevo as unknown as { invalidateAccountQuota: () => Promise<void> }).invalidateAccountQuota =
      async () => {};
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    // City filtering stays OFF. It is irrelevant to this item, and with it on
    // `create` demands a cityId on the DTO -- a requirement that belongs to
    // v2-24's tests, not to whether an invite can be withdrawn.
    await inTenant(async () => {
      city = await seedCity(prisma);
      location = await seedLocation(prisma, city.id);
      const admin = await seedUser(prisma, city.id, {
        role: UserRole.ADMIN,
        email: 'admin@example.test',
        calendarAutoInvite: false,
      });
      adminId = admin.id;
    });
  });

  /**
   * The sweeps are launched with `void` from `update()`, so the write that
   * matters happens after the call returns. Polling rather than a fixed sleep:
   * a sleep long enough to be reliable on a loaded machine is long enough to
   * make the suite unpleasant, and one short enough to be pleasant is the kind
   * of flake that teaches people to re-run until green.
   */
  const waitFor = async <T>(read: () => Promise<T[]>, atLeast: number): Promise<T[]> => {
    for (let i = 0; i < 100; i++) {
      const rows = await read();
      if (rows.length >= atLeast) return rows;
      await new Promise((r) => setTimeout(r, 20));
    }
    return read();
  };

  const queuedFor = (email: string, category: string) =>
    inTenant(() =>
      prisma.email_queue.findMany({ where: { toEmail: email, category }, orderBy: { id: 'asc' } }),
    );

  const seedMember = (email: string, overrides: Record<string, unknown> = {}) =>
    inTenant(() =>
      seedUser(prisma, city.id, {
        email,
        fullName: email.split('@')[0],
        calendarAutoInvite: true,
        ...overrides,
      }),
    );

  const publishEvent = async (locationId = location.id) =>
    inTenant(() =>
      events.create(
        {
          locationId,
          title: 'December Dinner',
          eventDate: '2026-12-01',
          eventTime: '12:00',
          status: EventStatus.PUBLISHED,
        } as Parameters<EventsService['create']>[0],
        adminId,
      ),
    );

  /** The single VCALENDAR on a queued row, unfolded, or null if there is none. */
  const icsOf = (row: { attachments: unknown }): string | null => {
    const list = row.attachments as { content: string; contentType?: string }[] | null;
    if (!list?.length) return null;
    return unfoldIcs(list[0].content);
  };

  const sequenceOf = (ics: string): number =>
    Number(/^SEQUENCE:(\d+)$/m.exec(ics)?.[1] ?? '-1');

  describe('a published event that moves day', () => {
    it('sends every invited recipient a REQUEST with the same UID and the new date', async () => {
      const responder = await seedMember('responder@example.test');
      // Seeded and never referenced again on purpose: this member does nothing
      // at all after being invited, which is exactly what makes them the case
      // this item is about.
      await seedMember('silent@example.test');

      const event = await publishEvent();

      // Both were auto-invited at publish, so both hold a calendar entry.
      const invites = await waitFor(
        () => inTenant(() => prisma.event_calendar_invites.findMany({ where: { eventId: event.id } })),
        2,
      );
      expect(invites.map((i) => i.email).sort()).toEqual([
        'responder@example.test',
        'silent@example.test',
      ]);
      const originalSequence = Math.max(...invites.map((i) => i.lastSequence));

      // One answers; the other never does. Before v2-50 the second got nothing.
      await inTenant(() => events.upsertRsvp(event.id, responder.id, RsvpStatus.GOING, 0));

      await inTenant(() =>
        events.update(event.id, { eventDate: '2026-12-02' } as Parameters<EventsService['update']>[1]),
      );

      for (const email of ['responder@example.test', 'silent@example.test']) {
        const rows = await waitFor(() => queuedFor(email, 'event_changed'), 1);
        expect(rows, `no update mail for ${email}`).toHaveLength(1);

        const ics = icsOf(rows[0]);
        expect(ics, `no invite attached for ${email}`).not.toBeNull();
        expect(ics).toContain('METHOD:REQUEST');
        // The UID is keyed on the event id alone, so it survives the move --
        // which is what makes the client update the entry instead of adding a
        // second one.
        expect(ics).toContain(`UID:communityevents-event-${event.id}@`);
        // 12:00 Eastern is 17:00 UTC on the SAME calendar day. Spelled out
        // because the first version of this assertion used 19:00, which is
        // 00:00Z the next day -- and a DTSTART of 20261203 for a dinner on the
        // 2nd reads as a defect rather than as a correct conversion.
        expect(ics).toContain('DTSTART:20261202T170000Z');
        expect(sequenceOf(ics!)).toBeGreaterThan(originalSequence);
      }
    });

    it('records a sequence the next change must exceed', async () => {
      await seedMember('member@example.test');
      const event = await publishEvent();
      await waitFor(
        () => inTenant(() => prisma.event_calendar_invites.findMany({ where: { eventId: event.id } })),
        1,
      );

      await inTenant(() =>
        events.update(event.id, { eventDate: '2026-12-02' } as Parameters<EventsService['update']>[1]),
      );
      const rows = await waitFor(() => queuedFor('member@example.test', 'event_changed'), 1);
      const sent = sequenceOf(icsOf(rows[0])!);

      // Polled, because the record is written AFTER the last send in the
      // sweep -- the queue row appearing is not the whole method finishing.
      const [record] = await waitFor(
        () =>
          inTenant(() =>
            prisma.event_calendar_invites.findMany({
              where: { eventId: event.id, lastSequence: { gte: sent } },
            }),
          ),
        1,
      );
      expect(record?.lastSequence).toBe(sent);
    });
  });

  describe('a cancelled event', () => {
    it('withdraws the entry from every invited recipient', async () => {
      const responder = await seedMember('responder@example.test');
      await seedMember('silent@example.test');

      const event = await publishEvent();
      const invites = await waitFor(
        () => inTenant(() => prisma.event_calendar_invites.findMany({ where: { eventId: event.id } })),
        2,
      );
      const originalSequence = Math.max(...invites.map((i) => i.lastSequence));

      await inTenant(() => events.upsertRsvp(event.id, responder.id, RsvpStatus.GOING, 0));

      await inTenant(() =>
        events.update(event.id, {
          status: EventStatus.CANCELLED,
          cancelledReason: 'Venue closed',
        } as Parameters<EventsService['update']>[1]),
      );

      for (const email of ['responder@example.test', 'silent@example.test']) {
        const rows = await waitFor(() => queuedFor(email, 'event_cancelled'), 1);
        expect(rows, `no cancellation mail for ${email}`).toHaveLength(1);

        const ics = icsOf(rows[0]);
        expect(ics, `no cancellation attached for ${email}`).not.toBeNull();
        expect(ics).toContain('METHOD:CANCEL');
        expect(ics).toContain('STATUS:CANCELLED');
        expect(ics).toContain(`UID:communityevents-event-${event.id}@`);
        expect(sequenceOf(ics!)).toBeGreaterThan(originalSequence);
      }
    });

    it('names the recipient as the attendee, which is what Google matches on', async () => {
      await seedMember('member@example.test');
      const event = await publishEvent();
      await waitFor(
        () => inTenant(() => prisma.event_calendar_invites.findMany({ where: { eventId: event.id } })),
        1,
      );

      await inTenant(() =>
        events.update(event.id, {
          status: EventStatus.CANCELLED,
        } as Parameters<EventsService['update']>[1]),
      );

      const rows = await waitFor(() => queuedFor('member@example.test', 'event_cancelled'), 1);
      expect(icsOf(rows[0])).toContain('mailto:member@example.test');
    });
  });

  /**
   * The negative case, and the one with teeth. A calendar entry outlives the
   * email it arrived in, so an address leaked into a LOCATION line is leaked
   * for good -- and the publish sweep's blanket `!isPrivate` rule is sound only
   * because every recipient *there* is a non-responder. Reusing it here would
   * hand the address to somebody the email body hides it from.
   */
  describe('a private venue', () => {
    it('keeps the address out of the invite of someone who may not see it', async () => {
      const privateLocation = await inTenant(() =>
        seedLocation(prisma, city.id, {
          isPrivate: true,
          address: '42 Secret Lane, Test City, OH 45202',
        }),
      );
      await seedMember('silent@example.test');

      const event = await publishEvent(privateLocation.id);
      await waitFor(
        () => inTenant(() => prisma.event_calendar_invites.findMany({ where: { eventId: event.id } })),
        1,
      );

      await inTenant(() =>
        events.update(event.id, { eventDate: '2026-12-02' } as Parameters<EventsService['update']>[1]),
      );

      const rows = await waitFor(() => queuedFor('silent@example.test', 'event_changed'), 1);
      const ics = icsOf(rows[0]);
      expect(ics).not.toBeNull();
      expect(ics).toContain('METHOD:REQUEST');
      expect(ics).not.toContain('42 Secret Lane');
      expect(rows[0].htmlBody).not.toContain('42 Secret Lane');
    });
  });

  /**
   * Guest links deliberately receive no invite: neither sender can reach one,
   * so there is no entry of theirs to move or withdraw, and a CANCEL would
   * withdraw nothing. They still get the notice they always got. This is the
   * decision written down, so changing it is a decision rather than a drift.
   */
  describe('guest links', () => {
    it('get the notice but no calendar attachment', async () => {
      const member = await seedMember('host@example.test');
      const event = await publishEvent();
      await waitFor(
        () => inTenant(() => prisma.event_calendar_invites.findMany({ where: { eventId: event.id } })),
        1,
      );
      await inTenant(() => events.upsertRsvp(event.id, member.id, RsvpStatus.GOING, 0));

      await inTenant(() =>
        prisma.event_guest_links.create({
          data: {
            eventId: event.id,
            token: 'guest-token-v250',
            recipientEmail: 'guest@example.test',
            recipientName: 'A Guest',
            source: 'public',
            expiresAt: new Date(Date.now() + 30 * 86_400_000),
          },
        }),
      );

      await inTenant(() =>
        events.update(event.id, { eventDate: '2026-12-02' } as Parameters<EventsService['update']>[1]),
      );

      const rows = await waitFor(() => queuedFor('guest@example.test', 'event_changed'), 1);
      expect(rows).toHaveLength(1);
      expect(icsOf(rows[0])).toBeNull();
    });
  });
});
