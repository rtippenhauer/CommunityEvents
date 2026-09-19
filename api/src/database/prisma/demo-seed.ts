/**
 * What a demo community contains (v2-14).
 *
 * One demo is provisioned per visitor who asks for one and confirms their
 * address, and it is deleted outright seven days later -- so this seeds a fresh
 * community and never wipes one. Deletion is `DemoService.deleteExpired`, which
 * removes the tenant row itself through the shared `purgeTenantRows`.
 *
 * **Tenancy.** Every write names `tenantId` explicitly. The caller is inside a
 * `runUnscoped` waiver -- it is writing into a community that no request is
 * scoped to -- and under a waiver the extension injects nothing, so an unnamed
 * `tenantId` takes the sentinel `DEFAULT 0` and is rejected by the foreign key.
 */
import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { LEGAL_DEFAULT_ROWS } from '../../common/legal/legal-defaults';
import { achievementDefaultRows } from '../../common/achievements/achievement-defaults';
import { createServiceAccount, tenantGetsServiceAccount } from './service-account.provision';
import { demoIconDataUri, demoLogoDataUri } from '../../common/demo/demo-brand';
import {
  DEMO_COLOR_ACCENT,
  DEMO_COLOR_BACKGROUND,
  DEMO_COLOR_PRIMARY,
  venuePhotoPath,
  venueSlug,
} from '../../common/demo/demo-venue-art';

const BCRYPT_COST = 12;

/**
 * The seeded members all share this, and it is printed by the provisioning
 * script and shown nowhere else.
 *
 * It is not a secret in any meaningful sense — the accounts it opens live in a
 * community that belongs to one visitor, holds nothing real, and is deleted
 * within the week. It is not advertised on the page either: the visitor is
 * already an admin of their own demo and has no reason to sign in as one of the
 * fictional members.
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

/**
 * The demo's own colours live in `demo-venue-art.ts` beside the artwork that
 * derives from them -- a community's palette and its pictures have to agree,
 * and two copies of a hex is how they stop agreeing.
 *
 * A community that has picked its colours is what a real one looks like; the
 * platform defaults are what an unconfigured install looks like, and the demo
 * exists to answer "what would this look like for my group". The river blue
 * also puts the whole palette on a hue nothing else here uses, which is a
 * standing check on v2-11's derivation and v2-14's measured wordmark ink --
 * both were only ever seen against the seeded amber before.
 */

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
}

/**
 * Fills a freshly created demo community.
 *
 * Two groups of rows, and only the second is demo content. The first is what
 * `TenantsAdminService.create` writes for any new community -- legal copy, the
 * achievement catalogue, a service account where one is warranted -- because a
 * demo is an ordinary community in every respect except that it expires and
 * cannot send mail.
 *
 * **No `email_provider_config` row, deliberately.** A demo may not mail anyone;
 * `EmailService.sendingIsBlocked` is what enforces that, since leaving the
 * config blank would have had the opposite effect -- v2-9 falls back to the
 * deployment's credentials for a community that has none of its own.
 */
export async function seedDemoTenant(
  prisma: PrismaClient,
  tenantId: number,
  opts: { isRoot?: boolean } = {},
): Promise<DemoSeedSummary> {
  const cityId = await resolveCityId(prisma);

  await seedSettings(prisma, tenantId);
  await seedLegal(prisma, tenantId);
  await seedAchievements(prisma, tenantId);

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
 * and until then the community's admin sees a banner asking them to. The demo's
 * admin is a visitor evaluating the product, so that banner would hand them a
 * compliance chore for a community with no members to protect that is deleted
 * within the week. Stamped at seed time, so the only standing notice on a demo
 * is the one that matters: when it disappears.
 */
async function seedSettings(prisma: PrismaClient, tenantId: number): Promise<void> {
  const rows = [
    { configKey: 'brand_name', configValue: DEMO_BRAND_NAME, description: 'Demo community name' },
    { configKey: 'brand_tagline', configValue: DEMO_BRAND_TAGLINE, description: 'Demo tagline' },
    { configKey: 'theme_color_primary', configValue: DEMO_COLOR_PRIMARY, description: 'Demo primary' },
    { configKey: 'theme_color_accent', configValue: DEMO_COLOR_ACCENT, description: 'Demo accent' },
    {
      configKey: 'theme_color_background',
      configValue: DEMO_COLOR_BACKGROUND,
      description: 'Demo page ground',
    },
    // Artwork rather than the generated fallback. The demo is a named fiction,
    // so it gets a drawn identity like any real community would -- see
    // demo-brand.ts for why the mark carries its own background.
    {
      configKey: 'brand_logo_url',
      configValue: demoLogoDataUri(DEMO_BRAND_NAME, DEMO_COLOR_PRIMARY),
      description: 'Demo lockup',
    },
    {
      configKey: 'brand_icon_url',
      configValue: demoIconDataUri(DEMO_COLOR_PRIMARY),
      description: 'Demo square mark',
    },
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
 * cannot be delivered to. Belt and braces: a demo cannot send mail at all
 * (`EmailService.sendingIsBlocked`), but seeded members generate notifications
 * like any other member, and a fixture that would mail a real stranger if one
 * guard were ever lifted is not a fixture worth keeping.
 */
async function seedMembers(
  prisma: PrismaClient,
  tenantId: number,
  cityId: number,
): Promise<{ id: number; fullName: string }[]> {
  // Hashed once. bcrypt at cost 12 is deliberately slow and every seeded member
  // shares this password, so hashing per member would add seconds to the
  // provisioning step a visitor is waiting on.
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

    // Cover art, so event cards are not four dark placeholder blocks down the
    // page -- which was the first thing a visitor saw and read as "there is
    // nothing in this product".
    //
    // A real photograph where one exists, and the generated panel where one
    // does not. Either way `filePath` holds a short path exactly as an uploaded
    // photo does, so the card component needs no special case: it renders
    // `photos[0].filePath` and neither knows nor cares which it got.
    const slug = venueSlug(venue.name);
    const photo = venuePhotoPath(slug);
    await prisma.location_photos.create({
      data: {
        tenantId,
        locationId: location.id,
        filePath: photo ?? `/api/v1/demo/venue-art/${slug}`,
        fileName: photo ? `${slug}.webp` : `${slug}.svg`,
        mimeType: photo ? 'image/webp' : 'image/svg+xml',
        sortOrder: 0,
        uploadedBy: createdById,
      },
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
