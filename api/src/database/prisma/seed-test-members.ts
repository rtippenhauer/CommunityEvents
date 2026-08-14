/**
 * Creates verified, password-login test members on a non-production
 * deployment.
 *
 * Written for v2-5 testing: stage has a single tenant with almost no members,
 * which makes the member directory, the leaderboard and anything ranked
 * impossible to judge. This fills that in with accounts that behave exactly
 * like real ones — verified email, a real bcrypt password hash, `member` role —
 * rather than half-built rows that only look right until something checks them.
 *
 * Every address is a plus-suffixed alias of one real mailbox, so mail these
 * accounts generate is genuinely deliverable and all of it lands in one inbox.
 *
 * NOT part of the install sequence. `migrate deploy` -> `seed.js` ->
 * `bootstrap.js` is unchanged; this is a separate, opt-in step.
 *
 * Run it in the container with:
 *
 *   ALLOW_TEST_MEMBERS=<database name> node dist/database/prisma/seed-test-members.js
 *
 * or locally with `npm run seed:test-members`.
 *
 * Uses its own PrismaClient rather than PrismaService, matching seed.ts and
 * bootstrap.ts. That deliberately puts it outside the tenant-scoping extension,
 * which is correct here: `users` is a global model (REQ-TENANT-01.5 gives it a
 * tenant in v2-6) and a maintenance script has no request to take a tenant from.
 * If this ever grows to create tenant-scoped rows — events, RSVPs — they will
 * need an explicit tenant_id, because nothing will add one for them.
 */
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

/** Matches AuthService.register, so these hashes verify like any other. */
const BCRYPT_COST = 12;

const DEFAULT_PASSWORD = 'P@ssw0rds!';
const DEFAULT_EMAIL_PATTERN = 'rtippenhauer+{code}@gmail.com';
const DEFAULT_COUNT = 12;

/**
 * Readable names so a leaderboard or directory is actually legible — "Ada
 * Whitfield" tells you which row moved where "Test User 7" does not. The code
 * is the first name lowercased, so the address and the display name match.
 */
const NAMES = [
  'Ada Whitfield',
  'Bruno Castellanos',
  'Camille Okonjo',
  'Dmitri Halloran',
  'Esther Lindqvist',
  'Felix Nakamura',
  'Greta Amankwah',
  'Hugo Bellweather',
  'Imani Sorensen',
  'Jonas Petrakis',
  'Kavya Rasmussen',
  'Leonie Marchetti',
  'Mateo Fitzgerald',
  'Nadia Brennan',
  'Oskar Delacroix',
  'Priya Vandenberg',
  'Quinn Alvarado',
  'Rosalind Achterberg',
  'Soren Mbeki',
  'Talia Kowalczyk',
];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

/**
 * Refuses to run unless the operator names the database they mean.
 *
 * This script writes accounts whose password is printed to the console, so
 * running it against the wrong deployment hands out working logins. A boolean
 * flag would not prevent that — the dangerous case is a correct-looking command
 * pointed at the wrong DB_NAME. Making the confirmation *be* the database name
 * means an accident has to spell out the thing it is about to damage.
 */
function assertTargetConfirmed(): void {
  const target = process.env.ALLOW_TEST_MEMBERS;
  const database = required('DB_NAME');

  if (!target) {
    throw new Error(
      'Refusing to create test members: set ALLOW_TEST_MEMBERS to the database name ' +
        `you intend to write to (currently DB_NAME=${database}).`,
    );
  }

  if (target !== database) {
    throw new Error(
      `Refusing to create test members: ALLOW_TEST_MEMBERS=${target} does not match ` +
        `DB_NAME=${database}.`,
    );
  }
}

async function main(): Promise<void> {
  assertTargetConfirmed();

  const password = process.env.TEST_MEMBER_PASSWORD ?? DEFAULT_PASSWORD;
  const pattern = process.env.TEST_MEMBER_EMAIL_PATTERN ?? DEFAULT_EMAIL_PATTERN;
  const count = Number(process.env.TEST_MEMBER_COUNT ?? DEFAULT_COUNT);

  if (!pattern.includes('{code}')) {
    throw new Error('TEST_MEMBER_EMAIL_PATTERN must contain {code}, or every member collides.');
  }
  if (!Number.isInteger(count) || count < 1 || count > NAMES.length) {
    throw new Error(`TEST_MEMBER_COUNT must be between 1 and ${NAMES.length}.`);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      // MySQL 8/9 need this over a non-TLS link; see PrismaService for the full
      // explanation of why its absence looks like a pool timeout.
      allowPublicKeyRetrieval: true,
      timezone: 'Z',
    }),
  });

  try {
    const cityId = await resolveCityId(prisma);

    // Hashed once. bcrypt at cost 12 is deliberately slow — around 250ms a call
    // — and every member shares this password, so hashing per member would turn
    // a two-second script into a visibly stalled one for no benefit.
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

    const created: { email: string; fullName: string }[] = [];

    for (const fullName of NAMES.slice(0, count)) {
      const code = fullName.split(' ')[0].toLowerCase();
      const email = pattern.replace('{code}', code).toLowerCase();

      // Upsert so re-running tops up the set and resets passwords rather than
      // failing on the unique email. `update` deliberately does not touch
      // cityId or role: once a member has been given a role by hand for
      // testing, a re-run should not quietly demote them.
      await prisma.users.upsert({
        where: { email },
        create: {
          fullName,
          email,
          passwordHash,
          cityId,
          role: 'member',
          status: 'active',
          // What "validated" means here: emailStatus `active` plus a
          // verification timestamp is exactly what AuthService.verifyEmail
          // writes, and login refuses any account still `pending`.
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

      created.push({ email, fullName });
    }

    console.log(`\n${created.length} test member(s) ready in "${process.env.DB_NAME}":\n`);
    for (const member of created) {
      console.log(`  ${member.email.padEnd(38)} ${member.fullName}`);
    }
    console.log(`\n  Password (all of them): ${password}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * The city these members join.
 *
 * `users.city_id` is required and `cities` is seeded before any tenant exists,
 * so there is always at least one by the time this runs — but pick explicitly
 * with TEST_MEMBER_CITY_ID on a deployment carrying more than one, rather than
 * letting the choice depend on insertion order.
 */
async function resolveCityId(prisma: PrismaClient): Promise<number> {
  const explicit = process.env.TEST_MEMBER_CITY_ID;
  if (explicit) {
    const city = await prisma.cities.findUnique({ where: { id: Number(explicit) } });
    if (!city) throw new Error(`TEST_MEMBER_CITY_ID=${explicit} does not exist.`);
    return city.id;
  }

  const city = await prisma.cities.findFirst({
    where: { isActive: true },
    orderBy: { id: 'asc' },
  });
  if (!city) {
    throw new Error('No active city exists — run the seed step before creating test members.');
  }
  return city.id;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
