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

    it('leaves every assignment alone on the way off', async () => {
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

      await prisma.user_city_preferences.create({
        data: { tenantId: TEST_TENANT_ID, userId: member.id, cityId: homeCity.id },
      });

      await asAdmin('put', '/admin/cities/feature').send({ enabled: false }).expect(200);

      // REQ-CITIES-01.6: "nothing is nulled out, so turning it on again lands
      // where it left off". Clearing these is what sent Rob's own account back
      // filed under whichever city he had restored to get the toggle moving.
      expect((await prisma.events.findFirst({ where: { id: past.id } }))!.cityId).toBe(homeCity.id);
      expect((await prisma.events.findFirst({ where: { id: future.id } }))!.cityId).toBe(homeCity.id);
      expect((await prisma.locations.findFirst({ where: { id: location.id } }))!.cityId).toBe(
        homeCity.id,
      );
      expect((await prisma.users.findFirst({ where: { id: member.id } }))!.cityId).toBe(homeCity.id);
      expect((await prisma.cities.findFirst({ where: { id: homeCity.id } }))!.isActive).toBe(true);
      expect(await prisma.user_city_preferences.findMany({ where: { userId: member.id } })).toHaveLength(1);
    });

    it('turns back on with no step in between, landing where it left off', async () => {
      const dayton = await seedCity(prisma, { name: 'Dayton' });
      await prisma.users.update({ where: { id: member.id }, data: { cityId: dayton.id } });

      await asAdmin('put', '/admin/cities/feature').send({ enabled: false }).expect(200);
      await asAdmin('put', '/admin/cities/feature').send({ enabled: true }).expect(200);

      // Not homeCity, which is what a re-backfill would have produced.
      expect((await prisma.users.findFirst({ where: { id: member.id } }))!.cityId).toBe(dayton.id);
    });

    it('backfills only what was created with no city while it was off', async () => {
      await asAdmin('put', '/admin/cities/feature').send({ enabled: false }).expect(200);
      const stranded = await seedLocation(prisma, null);
      await asAdmin('put', '/admin/cities/feature').send({ enabled: true }).expect(200);

      // The state the UI cannot draw — cities required, rows with none — must
      // not be observable at any point.
      expect(await prisma.users.findMany({ where: { cityId: null } })).toEqual([]);
      expect(await prisma.locations.findMany({ where: { cityId: null } })).toEqual([]);
      expect((await prisma.locations.findFirst({ where: { id: stranded.id } }))!.cityId).toBe(
        homeCity.id,
      );
    });

    it('refuses to turn on with no city to file anything under', async () => {
      await asAdmin('put', '/admin/cities/feature').send({ enabled: false }).expect(200);
      // Retired by hand, which is now the only way to reach this state -- the
      // off switch no longer does it. With nothing active there is nothing to
      // backfill to, and the refusal is the honest answer.
      await asAdmin('post', `/admin/cities/${homeCity.id}/retire`).send({}).expect(201);
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

  /**
   * Creating things while cities are off (Rob, on stage, 2026-11-01).
   *
   * `v2-24` made `city_id` nullable and the forms stop rendering a city field
   * when filtering is off -- but `CreateLocationDto` and `CreateEventDto` still
   * declared `@IsInt() @IsPositive() cityId: number`, so the request died in
   * the validation pipe with "cityId must be a positive number" before any
   * service saw it. The venue form's own notice said the venue would not
   * belong to a city, which the API then refused to allow.
   *
   * Whether a city is required is not a property of the request, so the DTO
   * cannot answer it -- only `resolveRequiredCityId` knows whether filtering
   * is on. Both directions are asserted here for that reason: optional in the
   * DTO must not become optional in effect.
   */
  /**
   * The default city (Rob, 2026-11-01).
   *
   * It exists because two code paths answered "which city" differently and
   * neither answer was chosen by anybody: the enable backfill took the lowest
   * id, a new member took the lowest *name*. Renaming a city silently moved
   * one of them. The marker makes it one explicit answer.
   */
  describe('the default city', () => {
    it('does not hand the marker to a city added second', async () => {
      // `homeCity` is seeded straight through Prisma and carries no marker,
      // which is the state `bootstrap.ts` left real communities in before
      // this column existed. Keying "is this the first city" on the *marker*
      // rather than on there being any active city made the second city the
      // default -- caught here rather than on stage.
      const second = await asAdmin('post', '/admin/cities').send({ name: 'Second' }).expect(201);

      const rows = await inTenant(TEST_TENANT_ID, () => prisma.cities.findMany());
      expect(rows.find((c) => c.id === second.body.id)!.isDefault).toBeNull();
      // Nothing is marked, so resolution falls back to the lowest active id --
      // still homeCity, which is what the behaviour was before the marker.
      expect(rows.filter((c) => c.isDefault === true)).toHaveLength(0);
    });

    it('marks a city default when the community has no active one', async () => {
      // Retired rather than deleted: members, venues and events point at
      // `homeCity` and the foreign keys are restrictive, which is the whole
      // reason retiring exists. Filtering is turned off first so retiring
      // needs no destination to move those rows to.
      await asAdmin('put', '/admin/cities/feature').send({ enabled: false }).expect(200);
      await asAdmin('post', `/admin/cities/${homeCity.id}/retire`).send({}).expect(201);

      const only = await asAdmin('post', '/admin/cities').send({ name: 'Only' }).expect(201);

      const rows = await inTenant(TEST_TENANT_ID, () => prisma.cities.findMany());
      expect(rows.filter((c) => c.isDefault === true).map((c) => c.id)).toEqual([only.body.id]);
    });

    it('moves the marker rather than adding a second one', async () => {
      const second = await asAdmin('post', '/admin/cities').send({ name: 'Second' }).expect(201);
      await asAdmin('post', `/admin/cities/${second.body.id}/default`).expect(201);

      const rows = await inTenant(TEST_TENANT_ID, () => prisma.cities.findMany());
      // The unique index would reject a second `true`, so a bare set without
      // the clear is a failed write rather than a subtly wrong one.
      expect(rows.filter((c) => c.isDefault === true).map((c) => c.id)).toEqual([second.body.id]);
    });

    it('files the backfill under the default, not the lowest id', async () => {
      const second = await asAdmin('post', '/admin/cities').send({ name: 'Second' }).expect(201);
      await asAdmin('post', `/admin/cities/${second.body.id}/default`).expect(201);

      await asAdmin('put', '/admin/cities/feature').send({ enabled: false }).expect(200);
      const venue = await asAdmin('post', '/locations')
        .send({ name: 'Filed Later', address: '9 Nowhere Rd' })
        .expect(201);
      await asAdmin('put', '/admin/cities/feature').send({ enabled: true }).expect(200);

      const row = await inTenant(TEST_TENANT_ID, () =>
        prisma.locations.findFirstOrThrow({ where: { id: venue.body.id } }),
      );
      expect(row.cityId).toBe(second.body.id);
    });

    it('refuses to make a retired city the default', async () => {
      const second = await asAdmin('post', '/admin/cities').send({ name: 'Second' }).expect(201);
      await asAdmin('post', `/admin/cities/${second.body.id}/retire`)
        .send({ moveToCityId: homeCity.id })
        .expect(201);
      await asAdmin('post', `/admin/cities/${second.body.id}/default`).expect(400);
    });

    it('hands the marker to the destination when the default is retired', async () => {
      const second = await asAdmin('post', '/admin/cities').send({ name: 'Second' }).expect(201);
      // The harness seeds `homeCity` straight through Prisma, so the marker
      // has to be put there explicitly — this is the state `bootstrap.ts`
      // now leaves a real community in.
      await asAdmin('post', `/admin/cities/${homeCity.id}/default`).expect(201);

      // Retire the default; its rows go to `second`, and so should the marker.
      await asAdmin('post', `/admin/cities/${homeCity.id}/retire`)
        .send({ moveToCityId: second.body.id })
        .expect(201);

      const rows = await inTenant(TEST_TENANT_ID, () => prisma.cities.findMany());
      expect(rows.filter((c) => c.isDefault === true).map((c) => c.id)).toEqual([second.body.id]);
    });

    it('is scoped: one community setting its default leaves another alone', async () => {
      await prisma.tenants.create({
        data: { id: TENANT_B_ID, slug: 'other-default', domain: TENANT_B_DOMAIN },
      });
      const theirCity = await inTenant(TENANT_B_ID, () => seedCity(prisma, { name: 'Theirs' }));
      await inTenant(TENANT_B_ID, () =>
        prisma.cities.update({ where: { id: theirCity.id }, data: { isDefault: true } }),
      );

      const second = await asAdmin('post', '/admin/cities').send({ name: 'Second' }).expect(201);
      await asAdmin('post', `/admin/cities/${second.body.id}/default`).expect(201);

      // The clear is an unfiltered `updateMany` leaning on the scoping
      // extension, exactly like the retirement walk above -- so assert it.
      const theirs = await inTenant(TENANT_B_ID, () =>
        prisma.cities.findFirstOrThrow({ where: { id: theirCity.id } }),
      );
      expect(theirs.isDefault).toBe(true);
    });
  });

  describe('creating things while cities are off', () => {
    const offThen = async () => {
      await asAdmin('put', '/admin/cities/feature').send({ enabled: false }).expect(200);
    };

    it('accepts a venue with no city and stores none', async () => {
      await offThen();

      const res = await asAdmin('post', '/locations')
        .send({ name: 'No City Diner', address: '1 Nowhere Rd' })
        .expect(201);

      const row = await inTenant(TEST_TENANT_ID, () =>
        prisma.locations.findFirstOrThrow({ where: { id: res.body.id } }),
      );
      expect(row.cityId).toBeNull();
    });

    it('accepts an explicit null just as it accepts an omission', async () => {
      await offThen();

      const res = await asAdmin('post', '/locations')
        .send({ name: 'Null City Diner', address: '2 Nowhere Rd', cityId: null })
        .expect(201);

      const row = await inTenant(TEST_TENANT_ID, () =>
        prisma.locations.findFirstOrThrow({ where: { id: res.body.id } }),
      );
      expect(row.cityId).toBeNull();
    });

    it('accepts an event with no city and stores none', async () => {
      await offThen();

      const venue = await asAdmin('post', '/locations')
        .send({ name: 'Eventless Diner', address: '3 Nowhere Rd' })
        .expect(201);

      const res = await asAdmin('post', '/events')
        .send({
          locationId: venue.body.id,
          title: 'A dinner in no city',
          eventDate: dateOffset(14),
          eventTime: '18:30',
        })
        .expect(201);

      const row = await inTenant(TEST_TENANT_ID, () =>
        prisma.events.findFirstOrThrow({ where: { id: res.body.id } }),
      );
      expect(row.cityId).toBeNull();
    });

    it('still refuses a venue with no city while filtering is ON', async () => {
      // The guard that makes the DTO change safe. Optional in the DTO is not
      // optional in effect: the service decides, and it says no here.
      await asAdmin('post', '/locations')
        .send({ name: 'Cityless While On', address: '4 Nowhere Rd' })
        .expect(400);
    });

    it('still refuses a city that belongs to nobody', async () => {
      // 0 used to be what the form sent for "none chosen". It is not an id and
      // must not become one by being allowed through as falsy.
      await offThen();
      await asAdmin('post', '/locations')
        .send({ name: 'Zero City', address: '5 Nowhere Rd', cityId: 0 })
        .expect(400);
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
