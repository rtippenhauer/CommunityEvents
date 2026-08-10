import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import type { cities as City, locations as Location, users as User } from '@prisma/client';
import { UserRole } from '../src/database/enums';

describe('Location privacy (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];

  let city: City;
  let admin: User;
  let adminCookie: string;
  let member: User;
  let memberCookie: string;
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

    admin = await seedUser(prisma, city.id, { role: UserRole.ADMIN, email: 'admin@example.test' });
    member = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member@example.test' });
    const member2 = await seedUser(prisma, city.id, { role: UserRole.MEMBER, email: 'member2@example.test' });
    adminCookie = await loginAs(app, admin);
    memberCookie = await loginAs(app, member);
    member2Cookie = await loginAs(app, member2);
  });

  async function createEvent(locationId: number, overrides: Record<string, unknown> = {}): Promise<{ id: number }> {
    const eventDate = new Date();
    eventDate.setDate(eventDate.getDate() + 14);
    const created = await request(server)
      .post('/api/v1/events')
      .set('Cookie', adminCookie)
      .send({
        cityId: city.id,
        locationId,
        title: 'Test Dinner',
        eventDate: eventDate.toISOString().slice(0, 10),
        eventTime: '18:30',
        ...overrides,
      })
      .expect(201);
    return created.body;
  }

  async function createPublishedEvent(locationId: number, overrides: Record<string, unknown> = {}): Promise<{ id: number }> {
    const event = await createEvent(locationId, overrides);
    await request(server).patch(`/api/v1/events/${event.id}`).set('Cookie', adminCookie).send({ status: 'published' }).expect(200);
    return event;
  }

  describe('GET /locations and /locations/:id', () => {
    it('hides the address of a private location from a member with no Going RSVP', async () => {
      const loc = await seedLocation(prisma, city.id, { isPrivate: true, name: "Bob's House" });

      const listRes = await request(server).get('/api/v1/locations').set('Cookie', memberCookie).expect(200);
      const inList = listRes.body.find((l: Location) => l.id === loc.id);
      expect(inList.address).toBeNull();

      const oneRes = await request(server).get(`/api/v1/locations/${loc.id}`).set('Cookie', memberCookie).expect(200);
      expect(oneRes.body.address).toBeNull();
    });

    it('always shows the address to admin/mod regardless of RSVP', async () => {
      const loc = await seedLocation(prisma, city.id, { isPrivate: true, address: '42 Secret Ln' });

      const res = await request(server).get(`/api/v1/locations/${loc.id}`).set('Cookie', adminCookie).expect(200);
      expect(res.body.address).toBe('42 Secret Ln');
    });

    it('shows the address to a member once they RSVP Going to an event there', async () => {
      const loc = await seedLocation(prisma, city.id, { isPrivate: true, address: '42 Secret Ln' });
      const event = await createPublishedEvent(loc.id);

      const before = await request(server).get(`/api/v1/locations/${loc.id}`).set('Cookie', memberCookie).expect(200);
      expect(before.body.address).toBeNull();

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going' })
        .expect(201);

      const after = await request(server).get(`/api/v1/locations/${loc.id}`).set('Cookie', memberCookie).expect(200);
      expect(after.body.address).toBe('42 Secret Ln');
    });

    it('never hides a public location address', async () => {
      const loc = await seedLocation(prisma, city.id, { isPrivate: false, address: '1 Main St' });
      const res = await request(server).get(`/api/v1/locations/${loc.id}`).set('Cookie', memberCookie).expect(200);
      expect(res.body.address).toBe('1 Main St');
    });
  });

  describe('GET /events and /events/:id — location snapshot fields', () => {
    it('hides locationAddress from a member who has not RSVPd Going', async () => {
      const loc = await seedLocation(prisma, city.id, { isPrivate: true, address: '42 Secret Ln' });
      const event = await createPublishedEvent(loc.id);

      const detail = await request(server).get(`/api/v1/events/${event.id}`).set('Cookie', memberCookie).expect(200);
      expect(detail.body.locationAddress).toBeNull();

      const list = await request(server).get('/api/v1/events').set('Cookie', memberCookie).expect(200);
      const inList = list.body.find((e: { id: number }) => e.id === event.id);
      expect(inList.locationAddress).toBeNull();
    });

    it('hides locationAddress from an unauthenticated viewer', async () => {
      const loc = await seedLocation(prisma, city.id, { isPrivate: true, address: '42 Secret Ln' });
      const event = await createPublishedEvent(loc.id);

      const res = await request(server).get(`/api/v1/events/${event.id}`).expect(200);
      expect(res.body.locationAddress).toBeNull();
    });

    it('shows locationAddress once the viewer has RSVPd Going to that event', async () => {
      const loc = await seedLocation(prisma, city.id, { isPrivate: true, address: '42 Secret Ln' });
      const event = await createPublishedEvent(loc.id);

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going' })
        .expect(201);

      const detail = await request(server).get(`/api/v1/events/${event.id}`).set('Cookie', memberCookie).expect(200);
      expect(detail.body.locationAddress).toBe('42 Secret Ln');

      const list = await request(server).get('/api/v1/events').set('Cookie', memberCookie).expect(200);
      const inList = list.body.find((e: { id: number }) => e.id === event.id);
      expect(inList.locationAddress).toBe('42 Secret Ln');
    });

    it("does not leak a Going member's visibility to a different, non-RSVPd member", async () => {
      const loc = await seedLocation(prisma, city.id, { isPrivate: true, address: '42 Secret Ln' });
      const event = await createPublishedEvent(loc.id);

      await request(server)
        .post(`/api/v1/events/${event.id}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going' })
        .expect(201);

      const detail = await request(server).get(`/api/v1/events/${event.id}`).set('Cookie', member2Cookie).expect(200);
      expect(detail.body.locationAddress).toBeNull();
    });

    it('always shows locationAddress to admin/mod', async () => {
      const loc = await seedLocation(prisma, city.id, { isPrivate: true, address: '42 Secret Ln' });
      const event = await createPublishedEvent(loc.id);

      const res = await request(server).get(`/api/v1/events/${event.id}`).set('Cookie', adminCookie).expect(200);
      expect(res.body.locationAddress).toBe('42 Secret Ln');
    });
  });

  describe('GET /invites/preview/:token — public/unauthenticated', () => {
    it('hides the address of a private location', async () => {
      const loc = await seedLocation(prisma, city.id, { isPrivate: true, address: '42 Secret Ln' });
      const event = await createPublishedEvent(loc.id);

      const created = await request(server)
        .post(`/api/v1/events/${event.id}/invite-links`)
        .set('Cookie', adminCookie)
        .send({ flavor: 'non_validated' })
        .expect(201);

      const res = await request(server).get(`/api/v1/invites/preview/${created.body.token}`).expect(200);
      expect(res.body.event.id).toBe(event.id);
      expect(res.body.event.locationAddress).toBeNull();
    });

    it('shows the address of a public location', async () => {
      const loc = await seedLocation(prisma, city.id, { isPrivate: false, address: '1 Main St' });
      const event = await createPublishedEvent(loc.id);

      const created = await request(server)
        .post(`/api/v1/events/${event.id}/invite-links`)
        .set('Cookie', adminCookie)
        .send({ flavor: 'non_validated' })
        .expect(201);

      const res = await request(server).get(`/api/v1/invites/preview/${created.body.token}`).expect(200);
      expect(res.body.event.locationAddress).toBe('1 Main St');
    });
  });

  describe('POST /locations — default privacy from app_config', () => {
    it('creates a public location by default', async () => {
      const res = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send({ name: 'Default Spot', address: '9 Default Rd', cityId: city.id })
        .expect(201);
      expect(res.body.isPrivate).toBe(false);
    });

    it('respects an explicit isPrivate on the create payload, overriding the config default', async () => {
      const res = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send({ name: 'Explicit Private', address: '9 Hidden Rd', cityId: city.id, isPrivate: true })
        .expect(201);
      expect(res.body.isPrivate).toBe(true);
    });

    it('uses the configured default when the site setting is switched to private', async () => {
      await request(server)
        .patch('/api/v1/admin/config/location_privacy_default')
        .set('Cookie', adminCookie)
        .send({ value: 'private' })
        .expect(200);

      const res = await request(server)
        .post('/api/v1/locations')
        .set('Cookie', adminCookie)
        .send({ name: 'Config Default Private', address: '9 Config Rd', cityId: city.id })
        .expect(201);
      expect(res.body.isPrivate).toBe(true);
    });
  });
});
