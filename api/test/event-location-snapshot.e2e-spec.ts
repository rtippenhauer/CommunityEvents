import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { cities as City, locations as Location, users as User } from '@prisma/client';
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { EmailService } from '../src/modules/email/email.service';
import { EnrichmentService } from '../src/modules/locations/enrichment.service';
import { EventStatus, UserRole } from '../src/database/enums';
import { toDateColumn } from '../src/common/utils/prisma-date.util';
import { easternToday } from '../src/common/utils/event-location-snapshot.util';

// Port of v1's event-location-snapshot.e2e-spec.ts (PR #41, v1.6.1). An event
// keeps its own copy of its location's name and address. Upcoming events must
// follow a location that's fixed later -- by hand or by enrichment -- and past
// or cancelled events keep what the place was called at the time.
describe('Event location details follow the location (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let city: City;
  let location: Location;
  let admin: User;
  let adminCookie: string;
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
    location = await seedLocation(prisma, city.id, {
      name: 'Izzyâs Forest Park',
      address: '1198 Smiley Ave, Forest Park, OH 45240',
    });
    admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    const member = await seedUser(prisma, city.id, { email: 'member@example.test' });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
  });

  function date(offsetDays: number): string {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return easternToday(d);
  }

  async function createEvent(eventDate: string): Promise<number> {
    const res = await request(server)
      .post('/api/v1/events')
      .set('Cookie', adminCookie)
      .send({
        cityId: city.id,
        locationId: location.id,
        title: 'Dinner',
        eventDate,
        eventTime: '18:30',
        status: 'draft',
      })
      .expect(201);
    return res.body.id;
  }

  const saved = (id: number) => prisma.events.findFirstOrThrow({ where: { id } });
  const moveTo = (id: number, eventDate: string) =>
    prisma.events.update({ where: { id }, data: { eventDate: toDateColumn(eventDate) } });

  it('editing a location updates its upcoming events, not its past or cancelled ones', async () => {
    const upcoming = await createEvent(date(7));
    const today = await createEvent(date(0));
    const past = await createEvent(date(10));
    await moveTo(past, date(-7));
    const cancelled = await createEvent(date(14));
    await prisma.events.update({
      where: { id: cancelled },
      data: { status: EventStatus.CANCELLED },
    });
    await prisma.events.updateMany({
      where: { id: { in: [upcoming, today] } },
      data: { status: EventStatus.PUBLISHED },
    });

    await request(server)
      .patch(`/api/v1/locations/${location.id}`)
      .set('Cookie', adminCookie)
      .send({ name: "Izzy's - Forest Park in Cincinnati" })
      .expect(200);

    expect((await saved(upcoming)).locationName).toBe("Izzy's - Forest Park in Cincinnati");
    expect((await saved(today)).locationName).toBe("Izzy's - Forest Park in Cincinnati");
    expect((await saved(past)).locationName).toBe('Izzyâs Forest Park');
    expect((await saved(cancelled)).locationName).toBe('Izzyâs Forest Park');

    const list = await request(server)
      .get('/api/v1/events?upcoming=true')
      .set('Cookie', memberCookie)
      .expect(200);
    expect(list.body.find((e: { id: number }) => e.id === upcoming).locationName).toBe(
      "Izzy's - Forest Park in Cincinnati",
    );
  });

  it('enrichment renaming or re-addressing a location updates upcoming events through the same helper', async () => {
    const upcoming = await createEvent(date(7));
    const past = await createEvent(date(10));
    await moveTo(past, date(-7));

    // Stand in for Google Places and Claude: enrichment finds a corrected name
    // and address for the place, and nothing else.
    const enrichment = app.get(EnrichmentService);
    // The four are private; reached through an explicit view rather than `any`.
    const internals = enrichment as unknown as {
      placesKey: () => Promise<string | null>;
      fetchPlaceDetails: () => Promise<unknown>;
      downloadStreetViewPhoto: () => Promise<boolean>;
      generateDescription: () => Promise<string | null>;
    };
    const spies = [
      vi.spyOn(internals, 'placesKey').mockResolvedValue('test-key'),
      vi.spyOn(internals, 'fetchPlaceDetails').mockResolvedValue({
        name: "Izzy's - Forest Park",
        formatted_address: '1198 Smiley Ave, Cincinnati, OH 45240, USA',
      }),
      vi.spyOn(internals, 'downloadStreetViewPhoto').mockResolvedValue(false),
      vi.spyOn(internals, 'generateDescription').mockResolvedValue(null),
    ];

    await enrichment.enrich({ ...location, city: null, photos: [] }, admin.id);
    spies.forEach((s) => s.mockRestore());

    expect(await saved(upcoming)).toMatchObject({
      locationName: "Izzy's - Forest Park",
      locationAddress: '1198 Smiley Ave, Cincinnati, OH 45240, USA',
    });
    expect((await saved(past)).locationName).toBe('Izzyâs Forest Park');
  });

  it('saving an upcoming event re-copies its location -- without emailing anyone', async () => {
    const id = await createEvent(date(7));
    await request(server)
      .patch(`/api/v1/events/${id}`)
      .set('Cookie', adminCookie)
      .send({ status: 'published' })
      .expect(200);
    await request(server)
      .post(`/api/v1/events/${id}/rsvp`)
      .set('Cookie', memberCookie)
      .send({ status: 'going' })
      .expect(201);
    // The location was fixed some other way (e.g. directly in the database).
    await prisma.locations.update({
      where: { id: location.id },
      data: {
        name: "Izzy's - Forest Park in Cincinnati",
        address: '1198 Smiley Ave, Cincinnati, OH 45240, USA',
      },
    });

    const queue = vi.spyOn(app.get(EmailService), 'queue');
    await request(server)
      .patch(`/api/v1/events/${id}`)
      .set('Cookie', adminCookie)
      .send({ title: 'Dinner at Izzy’s' })
      .expect(200);

    expect(await saved(id)).toMatchObject({
      locationName: "Izzy's - Forest Park in Cincinnati",
      locationAddress: '1198 Smiley Ave, Cincinnati, OH 45240, USA',
    });
    expect(queue).not.toHaveBeenCalled();
    queue.mockRestore();
  });

  it('saving a past event leaves its location details as they were', async () => {
    const id = await createEvent(date(7));
    await moveTo(id, date(-7));
    await prisma.locations.update({ where: { id: location.id }, data: { name: 'Renamed Since' } });

    await request(server)
      .patch(`/api/v1/events/${id}`)
      .set('Cookie', adminCookie)
      .send({ title: 'Old dinner' })
      .expect(200);
    expect((await saved(id)).locationName).toBe('Izzyâs Forest Park');
  });
});
