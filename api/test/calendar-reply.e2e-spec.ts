import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { cities as City, events as Event, users as User } from '@prisma/client';
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser } from './utils/seed';
import { TEST_TENANT_ID } from './setup-env';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { runUnscoped, runWithTenant } from '../src/common/tenant/tenant-store';
import { EventStatus, RsvpStatus, UserRole } from '../src/database/enums';
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
});
