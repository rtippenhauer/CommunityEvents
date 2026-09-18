/**
 * What the demo community contains, and how it gets back to containing exactly
 * that (v2-14).
 *
 * The demo is a tenant anyone may try: signing up there grants admin **of that
 * tenant only**, and because a demo admin can delete anything, the community is
 * wiped and re-seeded on a nightly schedule rather than left to accumulate
 * whatever visitors do to it.
 *
 * **Provisioning and resetting are the same code path.** `provision-demo.ts`
 * creates the tenant row and then calls `resetDemoTenant`; the nightly cron
 * calls `resetDemoTenant`. That is deliberate: if the two were separate, the
 * demo a visitor sees on day one and the demo they see after the first reset
 * could drift apart, and the drift would only ever be discovered by somebody
 * comparing two screenshots a day apart.
 *
 * **Tenancy.** Every write here names `tenantId` explicitly, because this runs
 * from two places that both sit outside the scoping extension's normal path: a
 * standalone script with its own bare `PrismaClient`, and a `@Cron` sweep that
 * enters `runUnscoped` (it has to — it is finding and rewriting one community's
 * rows while no request is in flight). Under a waiver the extension injects
 * nothing, so an unnamed `tenantId` takes the sentinel `DEFAULT 0` and is
 * rejected by the foreign key.
 */
import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { LEGAL_DEFAULT_ROWS } from '../../common/legal/legal-defaults';
import { achievementDefaultRows } from '../../common/achievements/achievement-defaults';
import { newEmailProviderConfig } from '../../common/email/email-config-defaults';
import { purgeTenantRows } from '../../common/tenant/tenant-purge';
import { createServiceAccount, tenantGetsServiceAccount } from './service-account.provision';

/** Matches AuthService.register, so these hashes verify like any other. */
const BCRYPT_COST = 12;

/**
 * The seeded members all share this, and it is printed by the provisioning
 * script and shown nowhere else.
 *
 * It is not a secret in any meaningful sense — the accounts it opens live in a
 * community that is erased nightly and holds nothing real — but it is also not
 * advertised on the page, because a visitor signing in as "Ada Whitfield"
 * instead of registering would skip the one flow the demo exists to show.
 */
export const DEMO_MEMBER_PASSWORD = 'DemoP@ssw0rd!';

/**
 * The demo presents as a plausible community rather than as a product tour.
 *
 * Somebody evaluating this is asking "what would my group's site look like",
 * and a tenant called "Demo" holding events called "Demo Event 1" answers a
 * different question. That it is a demo is carried by the standing notice in
 * the app shell, which says so on every page and cannot be missed — see
 * `isDemo` in the branding payload.
 */
const DEMO_BRAND_NAME = 'Riverside Community Events';
const DEMO_BRAND_TAGLINE = 'Good food. Great company. Every week.';

const MEMBER_NAMES = [
  'Ada Whitfield', 'Bruno Castellanos', 'Camille Okonjo', 'Dmitri Halloran',
  'Esther Lindqvist', 'Felix Nakamura', 'Greta Amankwah', 'Hugo Bellweather',
  'Imani Sorensen', 'Jonas Petrakis', 'Kavya Rasmussen', 'Leonie Marchetti',
];

const VENUES = [
  { name: 'The Copper Kettle', address: '412 Vine St, Cincinnati, OH 45202' },
  { name: 'Miriam and Sons', address: '88 Ludlow Ave, Cincinnati, OH 45220' },
  { name: 'Northside Noodle House', address: '4120 Hamilton Ave, Cincinnati, OH 45223' },
  { name: 'Pearl and Rye', address: '1201 Main St, Cincinnati, OH 45202' },
  { name: 'The Long Room', address: '3009 Madison Rd, Cincinnati, OH 45209' },
];

const REVIEW_COMMENTS = [
  'Great table for a big group, service kept up all night.',
  'Food was excellent, though it got loud once it filled up.',
  'Good value and they were happy to split the cheque.',
  'Lovely room, a bit slow between courses.',
];

const PAST_EVENT_COUNT = 6;
const UPCOMING_EVENT_COUNT = 2;

export interface DemoSeedSummary {
  members: number;
  locations: number;
  pastEvents: number;
  upcomingEvents: number;
  attended: number;
  ratings: number;
  /** Rows removed by the wipe, by model. Empty on a freshly provisioned tenant. */
  wiped: Record<string, number>;
}

/**
 * Erases everything in the demo community and seeds it again.
 *
 * The tenant row itself survives — this is a reset, not a delete, and the row
 * carries `is_demo`, the domain visitors are on right now, and the id every
 * later reset looks up.
 *
 * The wipe itself is `purgeTenantRows`, shared with `TenantsAdminService.remove`
 * — the two differ only in whether the `tenants` row survives, and having two
 * copies of a walk whose ORDER is load-bearing is how one of them ends up
 * quietly wrong. See that file for which foreign keys make it load-bearing.
 */
export async function resetDemoTenant(
  prisma: PrismaClient,
  tenantId: number,
  opts: { isRoot?: boolean } = {},
): Promise<DemoSeedSummary> {
  const wiped = await wipeDemoTenant(prisma, tenantId);
  const summary = await seedDemoTenant(prisma, tenantId, opts);
  return { ...summary, wiped };
}

async function wipeDemoTenant(
  prisma: PrismaClient,
  tenantId: number,
): Promise<Record<string, number>> {
  // One transaction, so a failure part-way leaves the demo intact rather than
  // half-erased — a half-erased demo is worse than a stale one, because it is
  // still serving and now inconsistent. The timeout is raised past Prisma's 5s
  // default for the same reason the purge raises it.
  return await prisma.$transaction(
    async (tx) => await purgeTenantRows(tx, tenantId),
    { timeout: 120_000, maxWait: 15_000 },
  );
}

/**
 * Everything a community needs in order to work, then everything the demo needs
 * in order to be worth looking at.
 *
 * The first group is not demo content — it is what `TenantsAdminService.create`
 * writes for any new community (legal copy, the achievement catalogue, an email
 * provider row, a service account where one is warranted). The wipe above
 * removes those too, since they are scoped rows like any other, so the reset has
 * to put them back or the demo comes up with blank Terms and no badges.
 */
async function seedDemoTenant(
  prisma: PrismaClient,
  tenantId: number,
  opts: { isRoot?: boolean },
): Promise<Omit<DemoSeedSummary, 'wiped'>> {
  const cityId = await resolveCityId(prisma);

  await seedSettings(prisma, tenantId);
  await seedLegal(prisma, tenantId);
  await seedAchievements(prisma, tenantId);
  await seedEmailConfig(prisma, tenantId);

  if (tenantGetsServiceAccount(opts.isRoot ?? false)) {
    await createServiceAccount(prisma, tenantId, cityId);
  }

  const members = await seedMembers(prisma, tenantId, cityId);
  const locations = await seedLocations(prisma, tenantId, cityId, members[0].id);
  const past = await seedEvents(prisma, tenantId, cityId, locations, members[0].id, {
    count: PAST_EVENT_COUNT,
    past: true,
  });
  const upcoming = await seedEvents(prisma, tenantId, cityId, locations, members[0].id, {
    count: UPCOMING_EVENT_COUNT,
    past: false,
  });
  const attended = await seedAttendance(prisma, tenantId, past, members);
  await seedUpcomingRsvps(prisma, tenantId, upcoming, members);
  const ratings = await seedRatings(prisma, tenantId, past, members);

  return {
    members: members.length,
    locations: locations.length,
    pastEvents: past.length,
    upcomingEvents: upcoming.length,
    attended,
    ratings,
  };
}

/**
 * The demo's own branding, plus one row that is there to *suppress* something.
 *
 * `legal_reviewed_at` is normally empty until a human confirms the seeded Terms,
 * and until then every admin of that community sees a banner asking them to. On
 * the demo every visitor is an admin, so that banner would greet all of them
 * with a task that belongs to nobody and cannot meaningfully be done — the demo
 * is erased nightly and has no members to protect. It is stamped as reviewed at
 * seed time so the only standing notice on the demo is the one that matters:
 * that the data is temporary.
 */
async function seedSettings(prisma: PrismaClient, tenantId: number): Promise<void> {
  const rows = [
    { configKey: 'brand_name', configValue: DEMO_BRAND_NAME, description: 'Demo community name' },
    { configKey: 'brand_tagline', configValue: DEMO_BRAND_TAGLINE, description: 'Demo tagline' },
    {
      configKey: 'legal_reviewed_at',
      configValue: new Date().toISOString(),
      description: 'Stamped by the demo seed; see demo-seed.ts',
    },
  ];
  await prisma.app_config.createMany({ data: rows.map((row) => ({ ...row, tenantId })) });
}

async function seedLegal(prisma: PrismaClient, tenantId: number): Promise<void> {
  await prisma.app_config.createMany({
    data: LEGAL_DEFAULT_ROWS.map((row) => ({ ...row, tenantId })),
  });
}

async function seedAchievements(prisma: PrismaClient, tenantId: number): Promise<void> {
  // The terms the catalogue's copy is written in. Taken from the platform
  // defaults rather than from this community's own settings, because those were
  // just wiped and are re-seeded above at the defaults anyway.
  await prisma.achievements.createMany({
    data: achievementDefaultRows({
      dinnerSingularLower: 'dinner',
      dinnerPluralLower: 'dinners',
    }).map((row) => ({ ...row, tenantId })),
  });
}

async function seedEmailConfig(prisma: PrismaClient, tenantId: number): Promise<void> {
  // No credential of its own: the demo lives on `demo.<deployment domain>`, so
  // `isOnDeploymentDomain` is true for it and it sends on the deployment's Brevo
  // account. That is the whole reason the address is derived as a subdomain
  // rather than configured — see `demoDomainFor`.
  await prisma.email_provider_config.create({
    data: { tenantId, ...newEmailProviderConfig() },
  });
}

/**
 * `users.city_id` is required and cities are seeded before any tenant exists, so
 * there is always one. Picked by id rather than by name: the demo does not care
 * which city it nominally sits in, only that the column is satisfiable.
 */
async function resolveCityId(prisma: PrismaClient): Promise<number> {
  const city = await prisma.cities.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } });
  if (!city) {
    throw new Error('No active city exists — run the seed step before provisioning the demo.');
  }
  return city.id;
}

/**
 * The seeded members.
 *
 * Their addresses are on `.invalid`, which RFC 2606 reserves and which therefore
 * cannot be delivered to. That is the point: the demo sends real mail on the
 * deployment's Brevo account, and seeded members generate notifications like any
 * other member — a seeded address at a real domain would mail a stranger nightly
 * and spend the deployment's allowance doing it.
 */
async function seedMembers(
  prisma: PrismaClient,
  tenantId: number,
  cityId: number,
): Promise<{ id: number; fullName: string }[]> {
  // Hashed once. bcrypt at cost 12 is deliberately slow and every seeded member
  // shares this password, so hashing per member would add seconds to a job that
  // runs nightly, for nothing.
  const passwordHash = await bcrypt.hash(DEMO_MEMBER_PASSWORD, BCRYPT_COST);

  const members: { id: number; fullName: string }[] = [];
  for (const fullName of MEMBER_NAMES) {
    const email = `${fullName.split(' ')[0].toLowerCase()}@riverside.invalid`;
    const member = await prisma.users.create({
      data: {
        tenantId,
        cityId,
        fullName,
        email,
        passwordHash,
        role: 'member',
        status: 'active',
        // `active` plus a verification timestamp is exactly what
        // AuthService.verifyEmail writes; login refuses anything still pending.
        emailStatus: 'active',
        emailVerifiedAt: new Date(),
      },
    });
    members.push({ id: member.id, fullName: member.fullName });
  }
  return members;
}

async function seedLocations(
  prisma: PrismaClient,
  tenantId: number,
  cityId: number,
  createdById: number,
): Promise<{ id: number; name: string; address: string }[]> {
  const locations: { id: number; name: string; address: string }[] = [];
  for (const venue of VENUES) {
    const location = await prisma.locations.create({
      data: { tenantId, cityId, createdById, name: venue.name, address: venue.address },
    });
    locations.push({ id: location.id, name: location.name, address: location.address });
  }
  return locations;
}

/**
 * Past events and upcoming ones, because they show different things.
 *
 * The past ones are what the leaderboard, the ratings queue and a member's
 * history are computed from — none of which can be judged from an empty table.
 * The upcoming ones are what a visitor can actually *do* something with: RSVP,
 * comment, invite a guest. A demo carrying only past events looks like a
 * community that folded.
 */
async function seedEvents(
  prisma: PrismaClient,
  tenantId: number,
  cityId: number,
  locations: { id: number; name: string; address: string }[],
  createdById: number,
  opts: { count: number; past: boolean },
): Promise<{ id: number; title: string }[]> {
  const events: { id: number; title: string }[] = [];

  for (let index = 0; index < opts.count; index += 1) {
    const venue = locations[index % locations.length];

    // Weekly, walking backwards from last week or forwards from next week.
    const eventDate = startOfDay(new Date());
    const weeks = 7 * (index + 1);
    eventDate.setDate(eventDate.getDate() + (opts.past ? -weeks : weeks));

    const event = await prisma.events.create({
      data: {
        tenantId,
        cityId,
        locationId: venue.id,
        locationName: venue.name,
        locationAddress: venue.address,
        title: `${venue.name} dinner`,
        description: 'Seeded demo event.',
        eventDate,
        // A DATE and a TIME column, so both arrive as Dates whose other half is
        // ignored; 1970-01-01 is the conventional carrier for a bare time.
        eventTime: new Date('1970-01-01T18:30:00Z'),
        status: 'published',
        publishedAt: opts.past ? eventDate : new Date(),
        createdById,
      },
    });
    events.push({ id: event.id, title: event.title });
  }
  return events;
}

/**
 * RSVPs marked attended, plus the attendance point each one earns.
 *
 * The point is written directly rather than through PointsService, because this
 * runs outside Nest in the script case. That means it has to match what the
 * service writes — `attendance` keyed on the event id — or the leaderboard adds
 * up to something the application would never have produced.
 *
 * Turnout descends with the member's position so the leaderboard has a genuine
 * ordering to look at rather than a flat tie.
 */
async function seedAttendance(
  prisma: PrismaClient,
  tenantId: number,
  events: { id: number }[],
  members: { id: number }[],
): Promise<number> {
  let written = 0;

  for (const [position, member] of members.entries()) {
    const attending = Math.max(1, events.length - position);

    for (const event of events.slice(0, attending)) {
      await prisma.event_rsvps.create({
        data: { tenantId, eventId: event.id, userId: member.id, status: 'going', attended: true },
      });
      await prisma.member_points.create({
        data: {
          tenantId,
          userId: member.id,
          pointType: 'attendance',
          referenceId: event.id,
          points: 1,
          awardedAt: new Date(),
        },
      });
      written += 1;
    }
  }
  return written;
}

/**
 * A partly-filled guest list on the upcoming events, so the seat counts and the
 * "who is coming" list are neither empty nor full — a visitor has to be able to
 * RSVP themselves, which a full event would not let them do.
 */
async function seedUpcomingRsvps(
  prisma: PrismaClient,
  tenantId: number,
  events: { id: number }[],
  members: { id: number }[],
): Promise<void> {
  for (const [index, event] of events.entries()) {
    for (const member of members.slice(0, 4 + index)) {
      await prisma.event_rsvps.create({
        data: { tenantId, eventId: event.id, userId: member.id, status: 'going' },
      });
    }
  }
}

/**
 * A handful of ratings, so the venue pages and the "rate your recent dinners"
 * queue both have something in them. Only the first few members rate, which
 * leaves the queue non-empty for everyone else — an entirely-rated fixture hides
 * the queue altogether.
 */
async function seedRatings(
  prisma: PrismaClient,
  tenantId: number,
  events: { id: number }[],
  members: { id: number }[],
): Promise<number> {
  const raters = members.slice(0, Math.min(4, members.length));
  let written = 0;

  for (const [position, member] of raters.entries()) {
    for (const event of events.slice(0, 2)) {
      const full = await prisma.events.findUnique({ where: { id: event.id } });
      if (!full?.locationId) continue;

      // Varied but deterministic, so averages differ between venues and a reset
      // does not reshuffle them.
      const base = 3 + ((position + event.id) % 3);
      await prisma.location_ratings.create({
        data: {
          tenantId,
          memberId: member.id,
          eventId: event.id,
          locationId: full.locationId,
          food: clampRating(base + 1),
          service: clampRating(base),
          valueRating: clampRating(base),
          noise: clampRating(base - 1),
          comment: REVIEW_COMMENTS[(position + event.id) % REVIEW_COMMENTS.length],
        },
      });
      written += 1;
    }
  }
  return written;
}

const clampRating = (value: number): number => Math.min(5, Math.max(1, value));

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}
