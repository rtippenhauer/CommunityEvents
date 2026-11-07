import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { MockInstance } from 'vitest';
import type { cities as City, locations as Location } from '@prisma/client';
import { createTestApp, truncateAllTables, resetThrottler } from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs, enableCities } from './utils/seed';
import { TEST_TENANT_ID } from './setup-env';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { EmailService } from '../src/modules/email/email.service';
import { CalendarService } from '../src/modules/calendar/calendar.service';
import { UserRole } from '../src/database/enums';

// Port of v1's publish-invites.e2e-spec.ts (PR #42, v1.6.1). Members who set
// Manage Calendar -> auto-invite get an email + calendar invite when an event
// is published -- whether it was published from a draft or created already
// published. The second path used to send nothing and refresh no feeds.
describe('Auto-invites on publish (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let server: Parameters<typeof request>[0];
  let city: City;
  let otherCity: City;
  let location: Location;
  let adminCookie: string;
  let sendNow: MockInstance;
  let invalidateAll: MockInstance;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    // `feature_cities` defaults OFF (v2-24), and with it off the service layer
    // writes `city_id` as null whatever the request carried -- the requirement
    // moved out of the database, so a spec that seeds a city and never turns
    // the feature on is testing a community that does not use cities.
    await enableCities(prisma, TEST_TENANT_ID);
    resetThrottler(app);
    city = await seedCity(prisma);
    otherCity = await seedCity(prisma);
    location = await seedLocation(prisma, city.id);
    const admin = await seedUser(prisma, city.id, {
      role: UserRole.ADMIN,
      email: 'admin@example.test',
    });
    adminCookie = await loginAs(app, admin);
    // Auto-invite is an on/off since v2-24; which cities it covers is the
    // member's `user_city_preferences` set, where **no rows means every city**.
    //
    // So the four fixtures are: opted in with no preferences (every city),
    // opted in and narrowed to the event's city, opted in and narrowed to a
    // different city, and opted out. The third is the one the old enum could
    // express only by accident -- it is the member who must NOT be mailed.
    await seedUser(prisma, otherCity.id, {
      fullName: 'Larry All',
      email: 'larry@example.test',
      calendarAutoInvite: true,
    });
    const cindy = await seedUser(prisma, city.id, {
      fullName: 'Cindy City',
      email: 'cindy@example.test',
      calendarAutoInvite: true,
    });
    const other = await seedUser(prisma, otherCity.id, {
      fullName: 'Other City',
      email: 'other@example.test',
      calendarAutoInvite: true,
    });
    await seedUser(prisma, city.id, {
      fullName: 'No Invites',
      email: 'none@example.test',
      calendarAutoInvite: false,
    });
    await prisma.user_city_preferences.createMany({
      data: [
        { userId: cindy.id, cityId: city.id },
        { userId: other.id, cityId: otherCity.id },
      ],
    });
    sendNow = vi.spyOn(app.get(EmailService), 'sendNow').mockResolvedValue(undefined as never);
    invalidateAll = vi.spyOn(app.get(CalendarService), 'invalidateAll');
  });

  afterEach(() => {
    sendNow.mockRestore();
    invalidateAll.mockRestore();
  });

  function futureDate(days = 14): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  async function createEvent(status: 'draft' | 'published'): Promise<number> {
    const res = await request(server)
      .post('/api/v1/events')
      .set('Cookie', adminCookie)
      .send({
        cityId: city.id,
        locationId: location.id,
        title: 'Dinner',
        eventDate: futureDate(),
        eventTime: '18:30',
        status,
      })
      .expect(201);
    return res.body.id;
  }

  // Invites are sent in the background; give them a moment.
  async function invitedEmails(): Promise<string[]> {
    for (let i = 0; i < 20 && sendNow.mock.calls.length < 2; i++)
      await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 200));
    return sendNow.mock.calls.map(([dto]) => (dto as { toEmail: string }).toEmail).sort();
  }

  it('invites "all" and same-city members when an event is created already published', async () => {
    await createEvent('published');
    expect(await invitedEmails()).toEqual(['cindy@example.test', 'larry@example.test']);
    expect(invalidateAll).toHaveBeenCalled();
  });

  it('still invites when a draft is published', async () => {
    const id = await createEvent('draft');
    await new Promise((r) => setTimeout(r, 300));
    expect(sendNow).not.toHaveBeenCalled();

    await request(server)
      .patch(`/api/v1/events/${id}`)
      .set('Cookie', adminCookie)
      .send({ status: 'published' })
      .expect(200);
    expect(await invitedEmails()).toEqual(['cindy@example.test', 'larry@example.test']);
  });

  it('sends nothing for an event created as a draft', async () => {
    await createEvent('draft');
    await new Promise((r) => setTimeout(r, 500));
    expect(sendNow).not.toHaveBeenCalled();
    expect(invalidateAll).not.toHaveBeenCalled();
  });
});
