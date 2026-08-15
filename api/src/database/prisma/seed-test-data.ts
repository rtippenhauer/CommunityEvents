/**
 * Populates a non-production tenant with enough realistic activity to judge the
 * member directory, the leaderboard, ratings and event history.
 *
 * Written for v2-5 testing: stage carries one tenant with almost no members, so
 * the surfaces whose raw SQL this item rewrote by hand — the directory, the
 * leaderboard, the ratings queue — have nothing in them to be wrong about.
 *
 * What it creates, per tenant:
 *   - members (global rows; see the tenancy note below)
 *   - locations, past published events, RSVPs marked attended
 *   - one attendance point per attended event, which is what the leaderboard sums
 *   - a few location ratings, which is what the ratings queue reads against
 *
 * Attendance is spread deterministically rather than randomly, so the
 * leaderboard has a real ordering and re-running produces the same one — a
 * shuffled leaderboard on every run makes "did my change break the ordering?"
 * unanswerable.
 *
 *   ALLOW_TEST_DATA=<database name> node dist/database/prisma/seed-test-data.js
 *
 * or locally with `npm run seed:test-data`.
 *
 * **Tenancy.** This uses its own PrismaClient, like seed.ts and bootstrap.ts,
 * which puts it outside the tenant-scoping extension. That is deliberate — a
 * maintenance script has no request to take a tenant from — but it means every
 * scoped row written here sets `tenantId` explicitly, because nothing will do
 * it automatically. Get that wrong and the row lands on the sentinel default,
 * where the foreign key rejects it.
 *
 * Members are keyed per tenant (`+<slug>-<name>@`). That predates `users`
 * carrying a `tenant_id` and is kept because it makes a seeded account
 * recognisable at a glance; as of v2-6 the rows are genuinely scoped too, so a
 * member seeded for one community no longer shows up in another's directory.
 */
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/** Matches AuthService.register, so these hashes verify like any other. */
const BCRYPT_COST = 12;

const DEFAULT_PASSWORD = 'P@ssw0rds!';
const DEFAULT_EMAIL_PATTERN = 'rtippenhauer+{code}@gmail.com';
const DEFAULT_MEMBER_COUNT = 12;
const DEFAULT_EVENT_COUNT = 6;

/**
 * Readable names so a leaderboard or directory is legible — "Ada Whitfield"
 * tells you which row moved where "Test User 7" does not.
 */
const NAMES = [
  'Ada Whitfield', 'Bruno Castellanos', 'Camille Okonjo', 'Dmitri Halloran',
  'Esther Lindqvist', 'Felix Nakamura', 'Greta Amankwah', 'Hugo Bellweather',
  'Imani Sorensen', 'Jonas Petrakis', 'Kavya Rasmussen', 'Leonie Marchetti',
  'Mateo Fitzgerald', 'Nadia Brennan', 'Oskar Delacroix', 'Priya Vandenberg',
  'Quinn Alvarado', 'Rosalind Achterberg', 'Soren Mbeki', 'Talia Kowalczyk',
];

const VENUES = [
  { name: 'The Copper Kettle', address: '412 Vine St, Cincinnati, OH 45202' },
  { name: 'Miriam’s Table', address: '88 Ludlow Ave, Cincinnati, OH 45220' },
  { name: 'Northside Noodle House', address: '4120 Hamilton Ave, Cincinnati, OH 45223' },
  { name: 'Pearl & Rye', address: '1201 Main St, Cincinnati, OH 45202' },
  { name: 'The Long Room', address: '3009 Madison Rd, Cincinnati, OH 45209' },
];

const REVIEW_COMMENTS = [
  'Great table for a big group, service kept up all night.',
  'Food was excellent, though it got loud once it filled up.',
  'Good value and they were happy to split the cheque.',
  'Lovely room, a bit slow between courses.',
];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

/**
 * Refuses to run unless the operator names the database they mean.
 *
 * This writes accounts whose password is printed to the console, so running it
 * against the wrong deployment hands out working logins. A boolean flag would
 * not prevent that — the dangerous case is a correct-looking command pointed at
 * the wrong DB_NAME — so the confirmation *is* the database name.
 */
function assertTargetConfirmed(): void {
  const target = process.env.ALLOW_TEST_DATA;
  const database = required('DB_NAME');

  if (target !== database) {
    throw new Error(
      'Refusing to create test data: set ALLOW_TEST_DATA to the database name you intend ' +
        `to write to (currently DB_NAME=${database}` +
        (target ? `, ALLOW_TEST_DATA=${target}` : '') +
        ').',
    );
  }
}

interface Tenant {
  id: number;
  slug: string;
  domain: string;
}

async function main(): Promise<void> {
  assertTargetConfirmed();

  const password = process.env.TEST_MEMBER_PASSWORD ?? DEFAULT_PASSWORD;
  const pattern = process.env.TEST_MEMBER_EMAIL_PATTERN ?? DEFAULT_EMAIL_PATTERN;
  const memberCount = Number(process.env.TEST_MEMBER_COUNT ?? DEFAULT_MEMBER_COUNT);
  const eventCount = Number(process.env.TEST_EVENT_COUNT ?? DEFAULT_EVENT_COUNT);

  if (!pattern.includes('{code}')) {
    throw new Error('TEST_MEMBER_EMAIL_PATTERN must contain {code}, or every member collides.');
  }
  if (!Number.isInteger(memberCount) || memberCount < 1 || memberCount > NAMES.length) {
    throw new Error(`TEST_MEMBER_COUNT must be between 1 and ${NAMES.length}.`);
  }
  if (!Number.isInteger(eventCount) || eventCount < 1 || eventCount > 52) {
    throw new Error('TEST_EVENT_COUNT must be between 1 and 52.');
  }

  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      // MySQL 8/9 need this over a non-TLS link; see PrismaService for why its
      // absence surfaces as an unexplained pool timeout.
      allowPublicKeyRetrieval: true,
      timezone: 'Z',
    }),
  });

  try {
    const tenant = await resolveTenant(prisma);
    const cityId = await resolveCityId(prisma);

    const members = await seedMembers(prisma, tenant, cityId, {
      pattern,
      password,
      count: memberCount,
    });
    const locations = await seedLocations(prisma, tenant, cityId, members[0].id);
    const events = await seedEvents(prisma, tenant, cityId, locations, members[0].id, eventCount);
    const attendance = await seedAttendance(prisma, tenant, events, members);
    const ratings = await seedRatings(prisma, tenant, events, members);

    console.log(
      `\nSeeded tenant #${tenant.id} "${tenant.slug}" (${tenant.domain}):\n` +
        `  ${members.length} members\n` +
        `  ${locations.length} locations\n` +
        `  ${events.length} past events\n` +
        `  ${attendance} attended RSVPs (one leaderboard point each)\n` +
        `  ${ratings} location ratings\n` +
        `\n  Password (all members): ${password}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Which tenant the scoped rows belong to.
 *
 * TEST_DATA_TENANT takes a domain or a slug; with nothing set it falls back to
 * the root tenant, which on a single-tenant deployment is the only sensible
 * answer. It is never inferred from insertion order — picking the wrong tenant
 * silently populates the wrong community.
 */
async function resolveTenant(prisma: PrismaClient): Promise<Tenant> {
  const wanted = process.env.TEST_DATA_TENANT;

  const tenant = wanted
    ? await prisma.tenants.findFirst({
        where: { OR: [{ domain: wanted.toLowerCase() }, { slug: wanted.toLowerCase() }] },
      })
    : await prisma.tenants.findFirst({ where: { rootMarker: true } });

  if (!tenant) {
    throw new Error(
      wanted
        ? `No tenant matches TEST_DATA_TENANT=${wanted} by domain or slug.`
        : 'No root tenant exists — run bootstrap.js before seeding test data.',
    );
  }
  return { id: tenant.id, slug: tenant.slug, domain: tenant.domain };
}

/**
 * `users.city_id` is required and cities are seeded before any tenant exists,
 * so there is always one — but pick explicitly with TEST_MEMBER_CITY_ID on a
 * deployment carrying more than one, rather than depending on insertion order.
 */
async function resolveCityId(prisma: PrismaClient): Promise<number> {
  const explicit = process.env.TEST_MEMBER_CITY_ID;
  if (explicit) {
    const city = await prisma.cities.findUnique({ where: { id: Number(explicit) } });
    if (!city) throw new Error(`TEST_MEMBER_CITY_ID=${explicit} does not exist.`);
    return city.id;
  }

  const city = await prisma.cities.findFirst({ where: { isActive: true }, orderBy: { id: 'asc' } });
  if (!city) {
    throw new Error('No active city exists — run the seed step before creating test data.');
  }
  return city.id;
}

async function seedMembers(
  prisma: PrismaClient,
  tenant: Tenant,
  cityId: number,
  opts: { pattern: string; password: string; count: number },
): Promise<{ id: number; email: string; fullName: string }[]> {
  // Hashed once. bcrypt at cost 12 is deliberately slow — roughly 250ms a call
  // — and every member shares this password, so hashing per member would turn a
  // two-second script into a visibly stalled one for nothing.
  const passwordHash = await bcrypt.hash(opts.password, BCRYPT_COST);

  const members = [];
  for (const fullName of NAMES.slice(0, opts.count)) {
    const code = `${tenant.slug}-${fullName.split(' ')[0].toLowerCase()}`;
    const email = opts.pattern.replace('{code}', code).toLowerCase();

    // Upsert so re-running tops up and resets passwords rather than colliding.
    // `update` deliberately leaves role and city alone: a member promoted by
    // hand for testing should not be silently demoted by the next run.
    const member = await prisma.users.upsert({
      // Compound key: email is unique per tenant now, and this script runs
      // outside the extension (see the file comment), so it names the tenant
      // like every other scoped write here.
      where: { tenantId_email: { tenantId: tenant.id, email } },
      create: {
        fullName,
        email,
        passwordHash,
        cityId,
        tenantId: tenant.id,
        role: 'member',
        status: 'active',
        // What "validated" means here: emailStatus `active` plus a verification
        // timestamp is exactly what AuthService.verifyEmail writes, and login
        // refuses any account still `pending`.
        emailStatus: 'active',
        emailVerifiedAt: new Date(),
      },
      update: {
        passwordHash,
        emailStatus: 'active',
        emailVerifiedAt: new Date(),
        status: 'active',
      },
    });
    members.push({ id: member.id, email: member.email, fullName: member.fullName });
  }
  return members;
}

async function seedLocations(
  prisma: PrismaClient,
  tenant: Tenant,
  cityId: number,
  createdById: number,
): Promise<{ id: number; name: string; address: string }[]> {
  const locations = [];
  for (const venue of VENUES) {
    // `locations` has no unique key on name, so idempotency is a lookup rather
    // than an upsert — scoped to this tenant, since two communities may well
    // both have a venue by the same name.
    const existing = await prisma.locations.findFirst({
      where: { name: venue.name, tenantId: tenant.id },
    });

    const location =
      existing ??
      (await prisma.locations.create({
        data: {
          name: venue.name,
          address: venue.address,
          cityId,
          createdById,
          tenantId: tenant.id,
        },
      }));
    locations.push({ id: location.id, name: location.name, address: location.address });
  }
  return locations;
}

async function seedEvents(
  prisma: PrismaClient,
  tenant: Tenant,
  cityId: number,
  locations: { id: number; name: string; address: string }[],
  createdById: number,
  count: number,
): Promise<{ id: number; title: string; eventDate: Date }[]> {
  const events = [];

  for (let index = 0; index < count; index += 1) {
    const venue = locations[index % locations.length];

    // Weekly, walking backwards from last week. All in the past, because an
    // event cannot have been attended before it happened and attendance is the
    // whole point of seeding these.
    const eventDate = startOfDay(new Date());
    eventDate.setDate(eventDate.getDate() - 7 * (index + 1));

    const title = `${venue.name} dinner — ${eventDate.toISOString().slice(0, 10)}`;

    const existing = await prisma.events.findFirst({ where: { title, tenantId: tenant.id } });
    const event =
      existing ??
      (await prisma.events.create({
        data: {
          cityId,
          locationId: venue.id,
          locationName: venue.name,
          locationAddress: venue.address,
          title,
          description: 'Seeded test event.',
          eventDate,
          // A DATE and a TIME column, so both are Dates whose other half is
          // ignored; 1970-01-01 is the conventional carrier for a bare time.
          eventTime: new Date('1970-01-01T18:30:00Z'),
          status: 'published',
          publishedAt: eventDate,
          createdById,
          tenantId: tenant.id,
        },
      }));
    events.push({ id: event.id, title: event.title, eventDate: event.eventDate });
  }
  return events;
}

/**
 * RSVPs marked attended, plus the attendance point each one earns.
 *
 * The point is written directly rather than by calling PointsService, because
 * this script runs outside Nest entirely. That means it has to match what the
 * service writes — `attendance` keyed on the event id — or the leaderboard adds
 * up to something the application would never have produced.
 *
 * Turnout descends with the member's position in the list so the leaderboard
 * has a genuine ordering to check rather than a flat tie: the first member
 * attends everything, the last attends one.
 */
async function seedAttendance(
  prisma: PrismaClient,
  tenant: Tenant,
  events: { id: number }[],
  members: { id: number }[],
): Promise<number> {
  let written = 0;

  for (const [position, member] of members.entries()) {
    const attending = Math.max(1, events.length - position);

    for (const event of events.slice(0, attending)) {
      const existingRsvp = await prisma.event_rsvps.findFirst({
        where: { eventId: event.id, userId: member.id },
      });
      if (!existingRsvp) {
        await prisma.event_rsvps.create({
          data: {
            eventId: event.id,
            userId: member.id,
            status: 'going',
            attended: true,
            tenantId: tenant.id,
          },
        });
      }

      // Unique on (userId, pointType, referenceId, tenantId) as of v2-5, which
      // is what lets the same member earn this in more than one community.
      const existingPoint = await prisma.member_points.findFirst({
        where: {
          userId: member.id,
          pointType: 'attendance',
          referenceId: event.id,
          tenantId: tenant.id,
        },
      });
      if (!existingPoint) {
        await prisma.member_points.create({
          data: {
            userId: member.id,
            pointType: 'attendance',
            referenceId: event.id,
            points: 1,
            awardedAt: new Date(),
            tenantId: tenant.id,
          },
        });
      }
      written += 1;
    }
  }
  return written;
}

/**
 * A handful of ratings, so the restaurant pages and the "rate your recent
 * dinners" queue have something to show. Only the first few members rate, so
 * the queue is non-empty for everyone else — an entirely-rated fixture would
 * hide the queue, which is one of the paths this item rewrote.
 */
async function seedRatings(
  prisma: PrismaClient,
  tenant: Tenant,
  events: { id: number }[],
  members: { id: number }[],
): Promise<number> {
  const raters = members.slice(0, Math.min(4, members.length));
  let written = 0;

  for (const [position, member] of raters.entries()) {
    for (const event of events.slice(0, 2)) {
      const rsvp = await prisma.event_rsvps.findFirst({
        where: { eventId: event.id, userId: member.id },
      });
      if (!rsvp) continue; // only attendees can rate

      const full = await prisma.events.findUnique({ where: { id: event.id } });
      if (!full?.locationId) continue;

      const existing = await prisma.location_ratings.findFirst({
        where: { memberId: member.id, eventId: event.id },
      });
      if (existing) continue;

      // Varied but deterministic, so averages differ between venues and a
      // re-run does not reshuffle them.
      const base = 3 + ((position + event.id) % 3);
      await prisma.location_ratings.create({
        data: {
          memberId: member.id,
          eventId: event.id,
          locationId: full.locationId,
          food: clampRating(base + 1),
          service: clampRating(base),
          valueRating: clampRating(base),
          noise: clampRating(base - 1),
          comment: REVIEW_COMMENTS[(position + event.id) % REVIEW_COMMENTS.length],
          tenantId: tenant.id,
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
