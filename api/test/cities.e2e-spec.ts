import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  truncateAllTables,
  TEST_TENANT_DOMAIN,
} from './utils/test-app';
import { seedCity, seedLocation, seedUser, loginAs, enableCities } from './utils/seed';
import { PrismaService } from '../src/database/prisma/prisma.service';
import { TenantResolutionService } from '../src/common/tenant/tenant-resolution.service';
import { runWithTenant } from '../src/common/tenant/tenant-store';
import { EventStatus, UserRole } from '../src/database/enums';
import { toDateColumn, toTimeColumn } from '../src/common/utils/prisma-date.util';
import { TEST_TENANT_ID } from './setup-env';

const TENANT_B_ID = 9024;
const TENANT_B_DOMAIN = 'other-cities.example.test';

const inTenant = <T>(tenantId: number, fn: () => Promise<T>): Promise<T> =>
  runWithTenant(tenantId, async () => await fn());

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * v2-24 (REQ-CITIES-01), asserted end to end.
 *
 * Four things this file is actually for, in rough order of how much damage
 * their absence did:
 *
 *  1. **Isolation.** `cities` was the one model the v2-6 scoping pass never
 *     touched, so `CitiesAdminController` was `@Roles(ADMIN)` over a global
 *     table — any community's admin could list, rename or retire a city
 *     another community depended on. Rob found that on stage during v2-12 and
 *     it was left open deliberately, because closing it properly is this item.
 *  2. **The toggle**, which rewrites data in both directions and therefore
 *     cannot go through the ordinary settings endpoint.
 *  3. **Retirement**, where the rule is "deactivate, never delete" and the
 *     thing that must survive it is a *past* event's city.
 *  4. **The preference set**, where no rows means every city — a default that
 *     reads the same as "never configured", which is the point.
 */
describe('Cities (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenants: TenantResolutionService;
  let server: Parameters<typeof request>[0];

  let adminCookie: string;
  let memberCookie: string;
  let moderatorCookie: string;
  let member: Awaited<ReturnType<typeof seedUser>>;
  let homeCity: { id: number; name: string };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    tenants = app.get(TenantResolutionService);
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateAllTables(prisma);
    tenants.clearCache();
    await enableCities(prisma, TEST_TENANT_ID);

    homeCity = await seedCity(prisma, { name: 'Cincinnati' });

    const admin = await seedUser(prisma, homeCity.id, {
      role: UserRole.ADMIN,
      email: 'admin@example.test',
    });
    const moderator = await seedUser(prisma, homeCity.id, {
      role: UserRole.MODERATOR,
      email: 'mod@example.test',
    });
    member = await seedUser(prisma, homeCity.id, {
      role: UserRole.MEMBER,
      email: 'member@example.test',
    });
    adminCookie = await loginAs(app, admin);
    moderatorCookie = await loginAs(app, moderator);
    memberCookie = await loginAs(app, member);
  });

  const asAdmin = (method: 'get' | 'post' | 'patch' | 'put', path: string) =>
    request(server)[method](`/api/v1${path}`).set('Cookie', adminCookie);

  // ── 1. Isolation ─────────────────────────────────────────────────────────

  describe('a community can only see and touch its own cities', () => {
    let theirCity: { id: number; name: string };
    let theirAdminCookie: string;

    beforeEach(async () => {
      await prisma.tenants.create({
        data: { id: TENANT_B_ID, slug: 'other-cities', domain: TENANT_B_DOMAIN },
      });
      // Inside B's context: `app_config` is scoped, so the extension refuses
      // to write a row for one tenant while another is in context.
      await inTenant(TENANT_B_ID, () => enableCities(prisma, TENANT_B_ID));

      // Both communities meet in a city of the same name. Before v2-24 the
      // globally-unique `subdomain` made that impossible to express, so in
      // practice the first community to claim a name took it from the rest.
      theirCity = await inTenant(TENANT_B_ID, () => seedCity(prisma, { name: 'Cincinnati' }));
      const theirAdmin = await inTenant(TENANT_B_ID, () =>
        seedUser(prisma, theirCity.id, { role: UserRole.ADMIN, email: 'admin@example.test' }),
      );
      theirAdminCookie = await inTenant(TENANT_B_ID, () => loginAs(app, theirAdmin as never));
    });

    it('lets two communities hold a city of the same name', () => {
      expect(theirCity.id).not.toBe(homeCity.id);
      expect(theirCity.name).toBe(homeCity.name);
    });

    /**
     * The counts are what make this conclusive rather than suggestive: each
     * side has a row belonging to the other available to leak. A check where
     * one side happens to be empty looks identical to a passing one.
     */
    it('shows each admin only their own, with the other available to leak', async () => {
      const mine = await asAdmin('get', '/admin/cities').expect(200);
      expect(mine.body.cities.map((c: { id: number }) => c.id)).toEqual([homeCity.id]);

      const theirs = await request(server)
        .get('/api/v1/admin/cities')
        .set('Host', TENANT_B_DOMAIN)
        .set('Cookie', theirAdminCookie)
        .expect(200);
      expect(theirs.body.cities.map((c: { id: number }) => c.id)).toEqual([theirCity.id]);
    });

    it('refuses to rename another community city, by id', async () => {
      await request(server)
        .patch(`/api/v1/admin/cities/${theirCity.id}`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .send({ name: 'Taken Over' })
        .expect(404);

      const untouched = await inTenant(TENANT_B_ID, () =>
        prisma.cities.findFirst({ where: { id: theirCity.id } }),
      );
      expect(untouched!.name).toBe('Cincinnati');
    });

    it('refuses to retire another community city, by id', async () => {
      await request(server)
        .post(`/api/v1/admin/cities/${theirCity.id}/retire`)
        .set('Host', TEST_TENANT_DOMAIN)
        .set('Cookie', adminCookie)
        .send({})
        .expect(404);

      const untouched = await inTenant(TENANT_B_ID, () =>
        prisma.cities.findFirst({ where: { id: theirCity.id } }),
      );
      expect(untouched!.isActive).toBe(true);
    });
  });

  // ── 2. Create, rename, roles ─────────────────────────────────────────────

  describe('POST /admin/cities', () => {
    it('creates a city for an admin', async () => {
      const res = await asAdmin('post', '/admin/cities').send({ name: 'Dayton' }).expect(201);
      expect(res.body).toMatchObject({ name: 'Dayton', isActive: true });
    });

    it('rejects a blank name', async () => {
      await asAdmin('post', '/admin/cities').send({ name: '' }).expect(400);
    });

    it('rejects a name this community already uses', async () => {
      await asAdmin('post', '/admin/cities').send({ name: 'Dayton' }).expect(201);
      await asAdmin('post', '/admin/cities').send({ name: 'Dayton' }).expect(409);
    });

    it('rejects a member and a moderator alike', async () => {
      await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', memberCookie)
        .send({ name: 'Dayton' })
        .expect(403);
      await request(server)
        .post('/api/v1/admin/cities')
        .set('Cookie', moderatorCookie)
        .send({ name: 'Dayton' })
        .expect(403);
    });

    it('rejects an anonymous caller', async () => {
      await request(server).post('/api/v1/admin/cities').send({ name: 'Dayton' }).expect(401);
    });
  });

  // ── 3. The public picker ─────────────────────────────────────────────────

  describe('GET /cities', () => {
    it('offers the active cities', async () => {
      const res = await request(server).get('/api/v1/cities').expect(200);
      expect(res.body.map((c: { id: number }) => c.id)).toEqual([homeCity.id]);
    });

    /**
     * The stage failure this exists for: Rob retired the seeded cities, and
     * every location and event still pointing at one lost its city in the UI.
     * Nothing was corrupted — the select was built from the active list, found
     * no option matching the row's `cityId`, and rendered blank; the event form
     * then refused to save at all, because `Validators.min(1)` saw an empty
     * control.
     */
    it('still offers a retired city when it is the row own current value', async () => {
      const dayton = await asAdmin('post', '/admin/cities').send({ name: 'Dayton' }).expect(201);
      await asAdmin('post', `/admin/cities/${dayton.body.id}/retire`)
        .send({ moveToCityId: homeCity.id })
        .expect(201);

      const plain = await request(server).get('/api/v1/cities').expect(200);
      expect(plain.body.map((c: { id: number }) => c.id)).not.toContain(dayton.body.id);

      const withInclude = await request(server)
        .get(`/api/v1/cities?include=${dayton.body.id}`)
        .expect(200);
      const retired = withInclude.body.find((c: { id: number }) => c.id === dayton.body.id);
      expect(retired).toBeDefined();
      expect(retired.isActive).toBe(false);
    });
  });

  // ── 4. Retirement ────────────────────────────────────────────────────────

  describe('retiring a city', () => {
    let dayton: { id: number };
    let pastEventId: number;
    let futureEventId: number;
    let locationId: number;

    beforeEach(async () => {
      const res = await asAdmin('post', '/admin/cities').send({ name: 'Dayton' }).expect(201);
      dayton = res.body;

      const location = await seedLocation(prisma, dayton.id, { name: 'Dayton Diner' });
      locationId = location.id;

      const base = {
        tenantId: TEST_TENANT_ID,
        cityId: dayton.id,
        locationId: location.id,
        locationName: location.name,
        locationAddress: location.address,
        createdById: member.id,
        eventTime: toTimeColumn('18:30'),
        status: EventStatus.PUBLISHED,
      };
      const past = await prisma.events.create({
        data: { ...base, title: 'Past Dayton dinner', eventDate: toDateColumn(dateOffset(-30)) },
      });
      const future = await prisma.events.create({
        data: { ...base, title: 'Future Dayton dinner', eventDate: toDateColumn(dateOffset(30)) },
      });
      pastEventId = past.id;
      futureEventId = future.id;

      await prisma.users.update({ where: { id: member.id }, data: { cityId: dayton.id } });
    });

    it('counts what it is about to move, per table, before committing', async () => {
      const res = await asAdmin('get', `/admin/cities/${dayton.id}/retirement-impact`).expect(200);
      expect(res.body.requiresDestination).toBe(true);

      const byModel = Object.fromEntries(
        res.body.rows.map((r: { model: string; count: number }) => [r.model, r.count]),
      );
      // The future event only: a past one keeps its city and is not moved.
      expect(byModel['events']).toBe(1);
      expect(byModel['locations']).toBe(1);
      expect(byModel['users']).toBe(1);
    });

    it('moves the future, leaves the past, and keeps the row', async () => {
      await asAdmin('post', `/admin/cities/${dayton.id}/retire`)
        .send({ moveToCityId: homeCity.id })
        .expect(201);

      const past = await prisma.events.findFirst({ where: { id: pastEventId } });
      const future = await prisma.events.findFirst({ where: { id: futureEventId } });
      const location = await prisma.locations.findFirst({ where: { id: locationId } });
      const movedMember = await prisma.users.findFirst({ where: { id: member.id } });
      const city = await prisma.cities.findFirst({ where: { id: dayton.id } });

      // A dinner that happened in Dayton happened in Dayton.
      expect(past!.cityId).toBe(dayton.id);
      expect(future!.cityId).toBe(homeCity.id);
      expect(location!.cityId).toBe(homeCity.id);
      expect(movedMember!.cityId).toBe(homeCity.id);
      // Never deleted — which is what keeps the past event's city resolvable.
      expect(city).not.toBeNull();
      expect(city!.isActive).toBe(false);
    });

    it('refuses without a destination while cities are on', async () => {
      await asAdmin('post', `/admin/cities/${dayton.id}/retire`).send({}).expect(400);
      const city = await prisma.cities.findFirst({ where: { id: dayton.id } });
      expect(city!.isActive).toBe(true);
    });

    it('refuses to move a city to itself', async () => {
      await asAdmin('post', `/admin/cities/${dayton.id}/retire`)
        .send({ moveToCityId: dayton.id })
        .expect(400);
    });

    it('drops the city from every member preference set', async () => {
      await prisma.user_city_preferences.create({
        data: { userId: member.id, cityId: dayton.id },
      });

      await asAdmin('post', `/admin/cities/${dayton.id}/retire`)
        .send({ moveToCityId: homeCity.id })
        .expect(201);

      const prefs = await prisma.user_city_preferences.findMany({ where: { userId: member.id } });
      expect(prefs).toEqual([]);
    });

    it('brings one back with restore, moving nothing', async () => {
      await asAdmin('post', `/admin/cities/${dayton.id}/retire`)
        .send({ moveToCityId: homeCity.id })
        .expect(201);
      await asAdmin('post', `/admin/cities/${dayton.id}/reactivate`).expect(201);

      const city = await prisma.cities.findFirst({ where: { id: dayton.id } });
      expect(city!.isActive).toBe(true);
      // The rows that moved out stay moved: restoring is not an undo.
      const future = await prisma.events.findFirst({ where: { id: futureEventId } });
      expect(future!.cityId).toBe(homeCity.id);
    });
  });

  // ── 5. The feature toggle ────────────────────────────────────────────────

  describe('the feature toggle', () => {
    it('is refused through the ordinary settings endpoint', async () => {
      // Both directions move rows, so the flag and the data have to travel
      // together. A plain PATCH would flip the switch and leave the data
      // behind it, which looks like it worked.
      await asAdmin('patch', '/admin/config/feature_cities').send({ value: 'false' }).expect(400);
      await asAdmin('patch', '/admin/config/bulk')
        .send({ entries: [{ key: 'feature_cities', value: 'false' }] })
        .expect(400);
    });

    it('clears future events, all locations and all members on the way off', async () => {
      const location = await seedLocation(prisma, homeCity.id);
      const past = await prisma.events.create({
        data: {
          tenantId: TEST_TENANT_ID,
          cityId: homeCity.id,
          locationId: location.id,
          locationName: location.name,
          locationAddress: location.address,
          createdById: member.id,
          title: 'Past dinner',
          eventDate: toDateColumn(dateOffset(-14)),
          eventTime: toTimeColumn('18:30'),
          status: EventStatus.PUBLISHED,
        },
      });
      const future = await prisma.events.create({
        data: {
          tenantId: TEST_TENANT_ID,
          cityId: homeCity.id,
          locationId: location.id,
          locationName: location.name,
          locationAddress: location.address,
          createdById: member.id,
          title: 'Future dinner',
          eventDate: toDateColumn(dateOffset(14)),
          eventTime: toTimeColumn('18:30'),
          status: EventStatus.PUBLISHED,
        },
      });

      await asAdmin('put', '/admin/cities/feature').send({ enabled: false }).expect(200);

      expect((await prisma.events.findFirst({ where: { id: past.id } }))!.cityId).toBe(homeCity.id);
      expect((await prisma.events.findFirst({ where: { id: future.id } }))!.cityId).toBeNull();
      expect((await prisma.locations.findFirst({ where: { id: location.id } }))!.cityId).toBeNull();
      expect((await prisma.users.findFirst({ where: { id: member.id } }))!.cityId).toBeNull();
      expect(await prisma.cities.findMany({ where: { isActive: true } })).toEqual([]);
    });

    it('backfills every null city on the way back on', async () => {
      await asAdmin('put', '/admin/cities/feature').send({ enabled: false }).expect(200);
      await asAdmin('post', `/admin/cities/${homeCity.id}/reactivate`).expect(201);
      await asAdmin('put', '/admin/cities/feature').send({ enabled: true }).expect(200);

      // The state the UI cannot draw — cities required, rows with none — must
      // not be observable at any point.
      expect(await prisma.users.findMany({ where: { cityId: null } })).toEqual([]);
      expect(await prisma.locations.findMany({ where: { cityId: null } })).toEqual([]);
    });

    it('refuses to turn on with no city to file anything under', async () => {
      await asAdmin('put', '/admin/cities/feature').send({ enabled: false }).expect(200);
      // Every city was retired by the step above, so there is nothing to
      // backfill to and the refusal is the honest answer.
      await asAdmin('put', '/admin/cities/feature').send({ enabled: true }).expect(400);
    });

    /**
     * `enableImplicitConversion` coerces a value to its declared type *before*
     * class-validator runs, so a bare `@IsBoolean()` accepts any non-empty
     * string as `true` (found in v2-29). Here that would run the backfill.
     */
    it('refuses a non-boolean rather than coercing it', async () => {
      await asAdmin('put', '/admin/cities/feature').send({ enabled: 'no' }).expect(400);
    });

    it('rejects a member', async () => {
      await request(server)
        .put('/api/v1/admin/cities/feature')
        .set('Cookie', memberCookie)
        .send({ enabled: false })
        .expect(403);
    });

    /**
     * The off path runs `updateMany({ where: {} })` against locations and
     * users — no predicate at all — inside a `$transaction`, and leans
     * entirely on the scoping extension to add the tenant.
     *
     * `tenant-purge.ts` says in as many words that "a transaction client is
     * not somewhere to bet on an extension being applied", so this asserts the
     * bet rather than taking it. **The other community must hold rows that
     * would be destroyed if the bet were wrong** — a check where the other
     * side is empty looks identical to a passing one and proves nothing.
     */
    it('leaves another community data alone', async () => {
      await prisma.tenants.create({
        data: { id: TENANT_B_ID, slug: 'other-cities', domain: TENANT_B_DOMAIN },
      });
      const theirCity = await inTenant(TENANT_B_ID, () =>
        seedCity(prisma, { name: 'Columbus' }),
      );
      const theirMember = await inTenant(TENANT_B_ID, () =>
        seedUser(prisma, theirCity.id, { email: 'them@example.test' }),
      );
      const theirLocation = await inTenant(TENANT_B_ID, () =>
        seedLocation(prisma, theirCity.id, { name: 'Their Diner' }),
      );
      const theirEvent = await inTenant(TENANT_B_ID, () =>
        prisma.events.create({
          data: {
            tenantId: TENANT_B_ID,
            cityId: theirCity.id,
            locationId: theirLocation.id,
            locationName: theirLocation.name,
            locationAddress: theirLocation.address,
            createdById: theirMember.id,
            title: 'Their future dinner',
            eventDate: toDateColumn(dateOffset(21)),
            eventTime: toTimeColumn('18:30'),
            status: EventStatus.PUBLISHED,
          },
        }),
      );

      await asAdmin('put', '/admin/cities/feature').send({ enabled: false }).expect(200);

      const after = await inTenant(TENANT_B_ID, async () => ({
        city: await prisma.cities.findFirst({ where: { id: theirCity.id } }),
        member: await prisma.users.findFirst({ where: { id: theirMember.id } }),
        location: await prisma.locations.findFirst({ where: { id: theirLocation.id } }),
        event: await prisma.events.findFirst({ where: { id: theirEvent.id } }),
      }));

      expect(after.city!.isActive).toBe(true);
      expect(after.member!.cityId).toBe(theirCity.id);
      expect(after.location!.cityId).toBe(theirCity.id);
      expect(after.event!.cityId).toBe(theirCity.id);
    });

    /** The same bet, on the retirement path, which filters only by `cityId`. */
    it('retiring a city does not reach into another community rows', async () => {
      await prisma.tenants.create({
        data: { id: TENANT_B_ID, slug: 'other-cities', domain: TENANT_B_DOMAIN },
      });
      const theirCity = await inTenant(TENANT_B_ID, () =>
        seedCity(prisma, { name: 'Cincinnati' }),
      );
      const theirMember = await inTenant(TENANT_B_ID, () =>
        seedUser(prisma, theirCity.id, { email: 'them@example.test' }),
      );

      const dayton = await asAdmin('post', '/admin/cities').send({ name: 'Dayton' }).expect(201);
      await asAdmin('post', `/admin/cities/${dayton.body.id}/retire`)
        .send({ moveToCityId: homeCity.id })
        .expect(201);

      const after = await inTenant(TENANT_B_ID, () =>
        prisma.users.findFirst({ where: { id: theirMember.id } }),
      );
      expect(after!.cityId).toBe(theirCity.id);
    });
  });

  // ── 6. The preference set is a filter, never a gate ──────────────────────

  describe('member city preferences', () => {
    let dayton: { id: number };
    let daytonEventId: number;

    beforeEach(async () => {
      const res = await asAdmin('post', '/admin/cities').send({ name: 'Dayton' }).expect(201);
      dayton = res.body;
      const location = await seedLocation(prisma, dayton.id);
      const event = await prisma.events.create({
        data: {
          tenantId: TEST_TENANT_ID,
          cityId: dayton.id,
          locationId: location.id,
          locationName: location.name,
          locationAddress: location.address,
          createdById: member.id,
          title: 'Dayton dinner',
          eventDate: toDateColumn(dateOffset(7)),
          eventTime: toTimeColumn('18:30'),
          status: EventStatus.PUBLISHED,
        },
      });
      daytonEventId = event.id;
    });

    it('defaults the event list to every city when nothing is chosen', async () => {
      const res = await request(server)
        .get('/api/v1/events')
        .set('Cookie', memberCookie)
        .expect(200);
      expect(res.body.map((e: { id: number }) => e.id)).toContain(daytonEventId);
    });

    it('narrows the event list once a set is chosen', async () => {
      await request(server)
        .patch('/api/v1/calendar/settings')
        .set('Cookie', memberCookie)
        .send({ cityIds: [homeCity.id] })
        .expect(200);

      const res = await request(server)
        .get('/api/v1/events')
        .set('Cookie', memberCookie)
        .expect(200);
      expect(res.body.map((e: { id: number }) => e.id)).not.toContain(daytonEventId);
    });

    it('lets the member ask past their own filter', async () => {
      await request(server)
        .patch('/api/v1/calendar/settings')
        .set('Cookie', memberCookie)
        .send({ cityIds: [homeCity.id] })
        .expect(200);

      // `cityId=all` exists because "no cities named" already means "all" in
      // storage — without it there is no way to say it in a query.
      const res = await request(server)
        .get('/api/v1/events?cityId=all')
        .set('Cookie', memberCookie)
        .expect(200);
      expect(res.body.map((e: { id: number }) => e.id)).toContain(daytonEventId);
    });

    /**
     * The DoD states this outright: nothing uses city as an access gate. A
     * filter that quietly became a permission would be invisible until
     * somebody could not RSVP to a dinner they had driven to.
     */
    it('never gates RSVP on the filter', async () => {
      await request(server)
        .patch('/api/v1/calendar/settings')
        .set('Cookie', memberCookie)
        .send({ cityIds: [homeCity.id] })
        .expect(200);

      await request(server)
        .get(`/api/v1/events/${daytonEventId}`)
        .set('Cookie', memberCookie)
        .expect(200);

      await request(server)
        .post(`/api/v1/events/${daytonEventId}/rsvp`)
        .set('Cookie', memberCookie)
        .send({ status: 'going' })
        .expect((res) => {
          if (res.status >= 400) {
            throw new Error(`RSVP refused with ${res.status}: ${JSON.stringify(res.body)}`);
          }
        });
    });

    it('stores "every city" as no rows, so a new city is included automatically', async () => {
      await request(server)
        .patch('/api/v1/calendar/settings')
        .set('Cookie', memberCookie)
        .send({ cityIds: [homeCity.id, dayton.id] })
        .expect(200);

      const prefs = await prisma.user_city_preferences.findMany({ where: { userId: member.id } });
      expect(prefs).toEqual([]);
    });

    it('refuses a city belonging to another community', async () => {
      await prisma.tenants.create({
        data: { id: TENANT_B_ID, slug: 'other-cities', domain: TENANT_B_DOMAIN },
      });
      const theirs = await inTenant(TENANT_B_ID, () => seedCity(prisma, { name: 'Columbus' }));

      await request(server)
        .patch('/api/v1/calendar/settings')
        .set('Cookie', memberCookie)
        .send({ cityIds: [theirs.id] })
        .expect(400);
    });
  });
});
