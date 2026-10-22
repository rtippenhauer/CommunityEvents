import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { cities as City, events as Event, users as User } from '@prisma/client';
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser } from './utils/seed';
import { TEST_TENANT_ID } from './setup-env';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import { EventStatus, InboundEmailOutcome, RsvpStatus, UserRole } from '../src/database/enums';
import { toDateColumn, toTimeColumn } from '../src/common/utils/prisma-date.util';

const CLOUDFLARE_SECRET = 'test-cloudflare-email-secret-not-for-real-use';

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

// Port of v1's calendar-reply.e2e-spec.ts (PR #45, v1.6.2), plus the tenancy
// v1 never had.
//
// Calendar Accept/Maybe/Decline replies arrive as raw email through the
// Cloudflare Email Worker. Gmail sends the text/calendar part quoted-printable:
// BEGIN:VCALENDAR stays readable but every "=" becomes "=3D", which the parser
// used to reject -- no Gmail reply was ever recorded.
//
// The Worker POSTs to one host, and communities on a subdomain of the
// deployment share its calendar address, so a reply about one community's
// event can arrive on another's host. The event the UID names decides the
// community; the host may only narrow it.
describe('Calendar email replies (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: TenantResolutionService;
  let server: Parameters<typeof request>[0];
  let city: City;
  let member: User;

  const TENANT_B_ID = 2;
  const TENANT_B_DOMAIN = 'second-community.test';
  // The same address holds an account in both communities -- email is unique
  // per tenant -- so a reply resolved against the wrong one would find a user.
  const SHARED_EMAIL = 'larry@example.test';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenants = app.get(TenantResolutionService);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma); // re-seeds the root tenant at TEST_TENANT_ID
    tenants.clearCache();
    resetThrottler(app);
    await prisma.tenants.create({
      data: { id: TENANT_B_ID, slug: 'second', domain: TENANT_B_DOMAIN },
    });
    city = await seedCity(prisma);
    member = await inTenant(TEST_TENANT_ID, () =>
      seedUser(prisma, city.id, { email: SHARED_EMAIL }),
    );
  });

  async function seedEvent(tenantId = TEST_TENANT_ID): Promise<Event> {
    return inTenant(tenantId, async () => {
      const location = await seedLocation(prisma, city.id);
      const admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN });
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return prisma.events.create({
        data: {
          cityId: city.id,
          locationId: location.id,
          locationName: location.name,
          locationAddress: location.address,
          createdById: admin.id,
          title: 'Reply Test Dinner',
          eventDate: toDateColumn(d.toISOString().slice(0, 10)),
          eventTime: toTimeColumn('18:30'),
          status: EventStatus.PUBLISHED,
        },
      });
    });
  }

  // The shape of a real Gmail "Accepted:" reply, trimmed: quoted-printable
  // calendar part with =3D escapes, a UTF-8 name and a soft line break.
  function gmailReply(eventId: number, partstat: string, email: string): string {
    return [
      'From: Larry <' + email + '>',
      'To: calendar@communityeventsproject.com',
      'Subject: Accepted: Dinner @ Tue Oct 20, 2026',
      'Content-Type: multipart/mixed; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      'Larry has accepted this invitation.',
      '--b1',
      'Content-Type: text/calendar; charset="UTF-8"; method=REPLY',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'BEGIN:VCALENDAR',
      'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
      'VERSION:2.0',
      'METHOD:REPLY',
      'BEGIN:VEVENT',
      'DTSTART:20261020T223000Z',
      `ATTENDEE;CUTYPE=3DINDIVIDUAL;ROLE=3DREQ-PARTICIPANT;PARTSTAT=3D${partstat};CN=3DLarry Mart=`,
      `=C3=ADn;X-NUM-GUESTS=3D0:mailto:${email}`,
      `UID:communityevents-event-${eventId}@communityeventsproject.com`,
      'END:VEVENT',
      'END:VCALENDAR',
      '--b1--',
    ].join('\r\n');
  }

  const rsvpsFor = (eventId: number) =>
    runUnscoped(
      'test: read every community',
      async () =>
        await prisma.event_rsvps.findMany({ where: { eventId }, include: { user: true } }),
    );

  async function send(raw: string, host?: string) {
    const req = request(server).post('/api/v1/calendar/rsvp-reply');
    if (host) req.set('Host', host);
    await req.set('X-Cloudflare-Secret', CLOUDFLARE_SECRET).send({ raw }).expect(200);
  }

  it('records a Gmail (quoted-printable) Accept as Going', async () => {
    const event = await seedEvent();
    await send(gmailReply(event.id, 'ACCEPTED', member.email!));
    const rsvps = await rsvpsFor(event.id);
    expect(rsvps).toHaveLength(1);
    expect(rsvps[0]).toMatchObject({ userId: member.id, status: RsvpStatus.GOING });
  });

  it('records Gmail Maybe and Decline too', async () => {
    const event = await seedEvent();
    await send(gmailReply(event.id, 'TENTATIVE', member.email!));
    expect((await rsvpsFor(event.id))[0]?.status).toBe(RsvpStatus.MAYBE);
    await send(gmailReply(event.id, 'DECLINED', member.email!));
    expect((await rsvpsFor(event.id))[0]?.status).toBe(RsvpStatus.NOT_GOING);
  });

  it('still reads an unencoded reply (PARTSTAT=ACCEPTED is not mistaken for an escape)', async () => {
    const event = await seedEvent();
    await send(
      `BEGIN:VCALENDAR\r\nMETHOD:REPLY\r\nBEGIN:VEVENT\r\nUID:communityevents-event-${event.id}@communityeventsproject.com\r\n` +
        `ATTENDEE;PARTSTAT=ACCEPTED;CN=Plain:mailto:${member.email}\r\nEND:VEVENT\r\nEND:VCALENDAR`,
    );
    expect((await rsvpsFor(event.id))[0]?.status).toBe(RsvpStatus.GOING);
  });

  it("records a reply posted to the deployment's host against the event's own community", async () => {
    // Tenant B shares the deployment's calendar address, so its member's reply
    // arrives on the root host. The same address also has an account on the
    // root tenant -- which must NOT be the one that gets the RSVP.
    const memberB = await inTenant(TENANT_B_ID, () =>
      seedUser(prisma, city.id, { email: SHARED_EMAIL }),
    );
    const eventB = await seedEvent(TENANT_B_ID);

    await send(gmailReply(eventB.id, 'ACCEPTED', SHARED_EMAIL));

    const rsvps = await rsvpsFor(eventB.id);
    expect(rsvps).toHaveLength(1);
    expect(rsvps[0]).toMatchObject({
      userId: memberB.id,
      status: RsvpStatus.GOING,
      tenantId: TENANT_B_ID,
    });
    expect(rsvps[0].user.tenantId).toBe(TENANT_B_ID);
  });

  it("refuses a reply posted to one community's own host about another community's event", async () => {
    const event = await seedEvent(TEST_TENANT_ID);
    await inTenant(TENANT_B_ID, () => seedUser(prisma, city.id, { email: SHARED_EMAIL }));

    await send(gmailReply(event.id, 'ACCEPTED', SHARED_EMAIL), TENANT_B_DOMAIN);

    expect(await rsvpsFor(event.id)).toHaveLength(0);
  });

  it("accepts a reply on a community's own host about its own event", async () => {
    const memberB = await inTenant(TENANT_B_ID, () =>
      seedUser(prisma, city.id, { email: SHARED_EMAIL }),
    );
    const eventB = await seedEvent(TENANT_B_ID);

    await send(gmailReply(eventB.id, 'DECLINED', SHARED_EMAIL), TENANT_B_DOMAIN);

    const rsvps = await rsvpsFor(eventB.id);
    expect(rsvps).toHaveLength(1);
    expect(rsvps[0]).toMatchObject({ userId: memberB.id, status: RsvpStatus.NOT_GOING });
  });

  /**
   * v2-34: every exit below used to be a `logger.warn` and a bare `return`, so
   * the entire failure mode was "a member pressed Accept and nothing happened".
   * These assert the log *row*, not the log line — the point of the item is
   * that the outcome now lands somewhere a human looks.
   *
   * Read unscoped because `inbound_emails` is global, which is precisely why
   * every tenant-facing read in the API has to carry its own predicate.
   */
  describe('writes an inbound log row for every outcome', () => {
    const logRows = () =>
      runUnscoped('test: the inbound log is global', async () =>
        prisma.inbound_emails.findMany({ orderBy: { id: 'asc' } }),
      );

    const onlyRow = async () => {
      const all = await logRows();
      expect(all).toHaveLength(1);
      return all[0];
    };

    it('records a successful reply, with the event and member on the row', async () => {
      const event = await seedEvent();
      await send(gmailReply(event.id, 'ACCEPTED', SHARED_EMAIL));

      const row = await onlyRow();
      expect(row).toMatchObject({
        outcome: InboundEmailOutcome.RECORDED,
        tenantId: TEST_TENANT_ID,
        eventId: event.id,
        userId: member.id,
        rsvpStatus: RsvpStatus.GOING,
      });
      // The envelope is parsed so the list reads without opening a row.
      expect(row.fromAddress).toContain(SHARED_EMAIL);
      expect(row.subject).toContain('Accepted');
      expect(row.rawBody).toContain('BEGIN:VCALENDAR');
    });

    it('distinguishes a reply that changed nothing from one that was recorded', async () => {
      const event = await seedEvent();
      await send(gmailReply(event.id, 'ACCEPTED', SHARED_EMAIL));
      await send(gmailReply(event.id, 'ACCEPTED', SHARED_EMAIL));

      const all = await logRows();
      expect(all.map((r) => r.outcome)).toEqual([
        InboundEmailOutcome.RECORDED,
        InboundEmailOutcome.UNCHANGED,
      ]);
    });

    it('records a message with no calendar part, which is what a human reply looks like', async () => {
      await send(['From: someone@example.test', 'Subject: thanks!', '', 'See you there'].join('\r\n'));

      expect(await onlyRow()).toMatchObject({ outcome: InboundEmailOutcome.NO_ICAL });
    });

    it('records an unrecognised UID', async () => {
      const raw = gmailReply(123, 'ACCEPTED', SHARED_EMAIL).replace(
        'UID:communityevents-event-123@communityeventsproject.com',
        'UID:not-one-of-ours@example.test',
      );
      await send(raw);

      expect(await onlyRow()).toMatchObject({ outcome: InboundEmailOutcome.UNKNOWN_UID });
    });

    it('records an event that does not exist', async () => {
      await send(gmailReply(999999, 'ACCEPTED', SHARED_EMAIL));

      expect(await onlyRow()).toMatchObject({
        outcome: InboundEmailOutcome.EVENT_NOT_FOUND,
        eventId: 999999,
      });
    });

    /**
     * Google Calendar's "Propose new time" (Rob, stage, 2026-10-21). It sends
     * `METHOD:COUNTER`, which failed the REPLY check and was filed as
     * `not_a_reply` — a correct classification and a useless row, since the
     * screen's label for it reads as "this was not calendar mail" and the one
     * actionable fact, that somebody wants a different time, was discarded.
     */
    it('records a proposed new time as itself, with the time asked for', async () => {
      const event = await seedEvent();
      const counter = [
        `From: Larry <${SHARED_EMAIL}>`,
        'To: calendar@communityeventsproject.com',
        'Subject: =?UTF-8?Q?Proposed_new_time=3A_Dinner?=',
        'Content-Type: text/calendar; charset="UTF-8"; method=COUNTER',
        '',
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'METHOD:COUNTER',
        'BEGIN:VEVENT',
        'DTSTART:20261103T230000Z',
        `ATTENDEE;PARTSTAT=TENTATIVE:mailto:${SHARED_EMAIL}`,
        `UID:communityevents-event-${event.id}@communityeventsproject.com`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      await send(counter);

      const row = await onlyRow();
      expect(row.outcome).toBe(InboundEmailOutcome.COUNTER_PROPOSAL);
      expect(row.eventId).toBe(event.id);
      expect(row.detail).toContain('2026-11-03 23:00');
      // And the subject is readable, rather than the raw encoded word that
      // showed on stage.
      expect(row.subject).toBe('Proposed new time: Dinner');
      // No RSVP is invented from a counter-proposal: a different time is a
      // different event, which is the organiser's decision.
      expect(await rsvpsFor(event.id)).toHaveLength(0);
    });

    /**
     * Two proposals from two members are two things to answer. This is the case
     * that made the folding rule wrong: keyed on the source address it would
     * never have folded anyway (Cloudflare egresses from a different node each
     * time), and folding it would have hidden the second member entirely.
     */
    it('keeps each proposed time as its own row rather than folding them', async () => {
      const event = await seedEvent();
      const counter = (minute: string) =>
        [
          `From: Larry <${SHARED_EMAIL}>`,
          'Subject: Proposed new time',
          'Content-Type: text/calendar; method=COUNTER',
          '',
          'BEGIN:VCALENDAR',
          'METHOD:COUNTER',
          'BEGIN:VEVENT',
          `DTSTART:20261103T23${minute}00Z`,
          `UID:communityevents-event-${event.id}@communityeventsproject.com`,
          'END:VEVENT',
          'END:VCALENDAR',
        ].join('\r\n');

      await send(counter('00'));
      await send(counter('30'));

      const all = await logRows();
      expect(all).toHaveLength(2);
      expect(all.every((r) => r.suppressedCount === 0)).toBe(true);
      expect(all[1].detail).toContain('23:30');
    });

    it('records a PARTSTAT we do not handle, and says which', async () => {
      const event = await seedEvent();
      await send(gmailReply(event.id, 'DELEGATED', SHARED_EMAIL));

      const row = await onlyRow();
      expect(row.outcome).toBe(InboundEmailOutcome.UNHANDLED_PARTSTAT);
      expect(row.detail).toContain('DELEGATED');
    });

    it('records an address that belongs to no member of that community', async () => {
      const event = await seedEvent();
      await send(gmailReply(event.id, 'ACCEPTED', 'stranger@example.test'));

      const row = await onlyRow();
      expect(row.outcome).toBe(InboundEmailOutcome.MEMBER_NOT_FOUND);
      expect(row.detail).toContain('stranger@example.test');
    });

    /**
     * **The multi-tenant fault**, and the reason the operator view exists.
     * Recorded against the community that OWNS the event rather than the host
     * the reply arrived on: the community missing an RSVP is the one whose
     * event it was. Both ends of the mismatch are on the row.
     */
    it('records a reply that arrived on the wrong community host', async () => {
      const event = await seedEvent(TEST_TENANT_ID);
      await inTenant(TENANT_B_ID, () => seedUser(prisma, city.id, { email: SHARED_EMAIL }));

      await send(gmailReply(event.id, 'ACCEPTED', SHARED_EMAIL), TENANT_B_DOMAIN);

      const row = await onlyRow();
      expect(row.outcome).toBe(InboundEmailOutcome.TENANT_MISMATCH);
      expect(row.tenantId).toBe(TEST_TENANT_ID);
      expect(row.detail).toContain(`tenant ${TENANT_B_ID}`);
    });

    it('records a bad secret, keeping the size and source but not the body', async () => {
      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', 'wrong')
        .send({ raw: 'secret-probe-body' })
        .expect(401);

      const row = await onlyRow();
      expect(row.outcome).toBe(InboundEmailOutcome.INVALID_SECRET);
      // The body of an unauthenticated request is attacker-supplied content.
      expect(row.rawBody).toBeNull();
      expect(row.sizeBytes).toBe('secret-probe-body'.length);
      expect(row.sourceIp).not.toBeNull();
    });

    /**
     * The failure the global `ValidationPipe` would have swallowed: it rejects
     * a malformed body before the handler runs, which is why `rsvpReply` takes
     * an `unknown` body and validates it itself. Without that, this row could
     * not exist — and it is the one most likely to mean somebody is probing us.
     */
    it('records a malformed body, which a DTO would have rejected before the handler', async () => {
      await request(server)
        .post('/api/v1/calendar/rsvp-reply')
        .set('X-Cloudflare-Secret', CLOUDFLARE_SECRET)
        .send({ notRaw: 42 })
        .expect(400);

      const row = await onlyRow();
      expect(row.outcome).toBe(InboundEmailOutcome.MALFORMED_REQUEST);
      expect(row.rawBody).toBeNull();
    });

    /**
     * Repeats from one source fold into the row they repeat rather than each
     * writing their own, because this endpoint is unauthenticated and the log
     * has to stay bounded. It must not go *quiet* to do it, which is what the
     * counter is for: a row that climbs is visible, a row never written is not.
     */
    it('folds repeated identical failures into one row with a counter', async () => {
      for (let i = 0; i < 3; i++) {
        await request(server)
          .post('/api/v1/calendar/rsvp-reply')
          .set('X-Cloudflare-Secret', 'wrong')
          .send({ raw: 'probe' })
          .expect(401);
      }

      const all = await logRows();
      expect(all).toHaveLength(1);
      expect(all[0].suppressedCount).toBe(2);
    });

    it('never folds a successful reply, however many arrive', async () => {
      const first = await seedEvent();
      const second = await seedEvent();
      await send(gmailReply(first.id, 'ACCEPTED', SHARED_EMAIL));
      await send(gmailReply(second.id, 'ACCEPTED', SHARED_EMAIL));

      const all = await logRows();
      expect(all).toHaveLength(2);
      expect(all.every((r) => r.suppressedCount === 0)).toBe(true);
    });
  });
});
