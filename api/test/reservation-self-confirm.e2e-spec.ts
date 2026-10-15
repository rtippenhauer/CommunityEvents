import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  cities as City,
  events as Event,
  locations as Location,
  users as User,
} from '@prisma/client';
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { EventStatus, UserRole } from '../src/database/enums';
import { toDateColumn, toTimeColumn } from '../src/common/utils/prisma-date.util';

// Port of v1's reservation-self-confirm.e2e-spec.ts (PR #47, v1.6.3). The
// member assigned to book the table sees "I Made the Reservation", which called
// the admin/moderator-only PATCH -- so every ordinary member got "Failed to
// update". setReservation already treated the assignee as a self-confirm; only
// the route blocked them.
describe('Assignee confirms their own reservation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let city: City;
  let location: Location;
  let admin: User;
  let assignee: User;
  let assigneeCookie: string;
  let otherCookie: string;

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
    assignee = await seedUser(prisma, city.id, {
      fullName: 'Larry Martin',
      email: 'larry@example.test',
    });
    const other = await seedUser(prisma, city.id, { email: 'other@example.test' });
    assigneeCookie = await loginAs(app, assignee);
    otherCookie = await loginAs(app, other);
  });

  async function seedEvent(
    overrides: { reservationAssigneeId?: number | null } = {},
  ): Promise<Event> {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return prisma.events.create({
      data: {
        cityId: city.id,
        locationId: location.id,
        locationName: location.name,
        locationAddress: location.address,
        createdById: admin.id,
        title: 'Reservation Dinner',
        eventDate: toDateColumn(d.toISOString().slice(0, 10)),
        eventTime: toTimeColumn('18:30'),
        status: EventStatus.PUBLISHED,
        reservationAssigneeId: assignee.id,
        ...overrides,
      },
    });
  }

  const saved = (id: number) => prisma.events.findFirstOrThrow({ where: { id } });

  it('lets the assigned member mark the reservation made', async () => {
    const event = await seedEvent();
    const res = await request(server)
      .post(`/api/v1/events/${event.id}/reservation/confirm`)
      .set('Cookie', assigneeCookie)
      .expect(201);

    const row = await saved(event.id);
    expect(Boolean(row.reservationConfirmed)).toBe(true);
    expect(row.reservationConfirmedBy).toBe('Larry Martin');
    expect(row.reservationConfirmedAt).not.toBeNull();
    // The event page stores this response in its signal, so it must carry the
    // GET's date strings rather than ISO timestamps (v2-11).
    expect(res.body.eventTime).toBe('18:30:00');
    expect(res.body.eventDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('refuses any other member, and leaves the reservation unconfirmed', async () => {
    const event = await seedEvent();
    await request(server)
      .post(`/api/v1/events/${event.id}/reservation/confirm`)
      .set('Cookie', otherCookie)
      .expect(403);
    expect(Boolean((await saved(event.id)).reservationConfirmed)).toBe(false);
  });

  it('refuses everyone when nobody is assigned', async () => {
    const event = await seedEvent({ reservationAssigneeId: null });
    await request(server)
      .post(`/api/v1/events/${event.id}/reservation/confirm`)
      .set('Cookie', otherCookie)
      .expect(403);
  });

  it('answers 404 for an event that does not exist', async () => {
    await request(server)
      .post('/api/v1/events/999999/reservation/confirm')
      .set('Cookie', assigneeCookie)
      .expect(404);
  });

  it('requires a login', async () => {
    const event = await seedEvent();
    await request(server).post(`/api/v1/events/${event.id}/reservation/confirm`).expect(401);
  });

  it('still keeps the full reservation PATCH admin/moderator-only', async () => {
    const event = await seedEvent();
    await request(server)
      .patch(`/api/v1/events/${event.id}/reservation`)
      .set('Cookie', assigneeCookie)
      .send({ confirmed: true })
      .expect(403);
  });

  it('returns date strings from the admin PATCH too', async () => {
    const event = await seedEvent();
    const adminCookie = await loginAs(app, admin);
    const res = await request(server)
      .patch(`/api/v1/events/${event.id}/reservation`)
      .set('Cookie', adminCookie)
      .send({ confirmed: true })
      .expect(200);
    expect(res.body.eventTime).toBe('18:30:00');
  });
});
