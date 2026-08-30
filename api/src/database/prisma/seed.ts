import * as fs from 'node:fs';
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';

/**
 * Read at runtime rather than `import`ed. TypeScript can import JSON directly,
 * but only with resolveJsonModule plus the right interop settings, and those
 * have to be threaded through whichever runner invokes this file. Reading the
 * files keeps the seed independent of compiler configuration.
 */
function load(table: string): Record<string, unknown>[] {
  // Resolved relative to this file so it works identically from src/ under
  // ts-node and from dist/ in the production image -- dist mirrors src, so the
  // same number of levels lands on api/prisma/seed-data either way.
  const file = path.join(__dirname, '..', '..', '..', 'prisma', 'seed-data', `${table}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const achievements = load('achievements');
const avatar = load('avatar');
const cities = load('cities');
const merchConfig = load('merch_config');

dotenv.config({ path: path.join(__dirname, '../../../../.env') });

/**
 * Reference and config data a brand-new install needs before it can function.
 *
 * v2 starts from a blank database and imports real records from production
 * separately, so this file covers only the rows the application itself
 * assumes exist -- the achievements catalogue, the avatar set, the city list --
 * not user-generated data.
 *
 * **Everything here is tenant-independent, and that is now a hard rule rather
 * than an observation.** This runs before bootstrap.js, so no tenant exists
 * yet; any row it wrote to a tenant-scoped table would take the `tenant_id`
 * sentinel 0 and be rejected by that table's foreign key. The `app_config`
 * defaults and the automation service account used to live here and moved to
 * bootstrap.ts in v2-6 for exactly that reason -- both belong to a specific
 * community, and bootstrap is where the community first exists.
 *
 * These rows previously arrived as INSERTs scattered across 20 of the 84
 * TypeORM migrations. Collecting them here is what makes those migrations
 * disposable: with the schema owned by a single Prisma migration, the only
 * thing the old migration history still carried was this data.
 *
 * Idempotent by design. Every table is upserted on a natural key, so running
 * it against an already-seeded database is a no-op rather than a duplicate-key
 * failure, and it can be re-run after adding new reference rows.
 *
 * Order-independent too, which is why the captured rows carry no `id` for the
 * tables found by a natural key. Pinning the surrogate ids made the seed fail
 * with a PRIMARY key violation whenever anything had already inserted a row --
 * running bootstrap.js first was enough, because its city took id 1 and the
 * seed then tried to create Cincinnati as id 1 as well. The ids are left to
 * auto-increment; nothing references these rows by id.
 *
 * merch_config is the exception and keeps id 1: it is a true singleton that the
 * application looks up by that id.
 *
 * email_provider_config used to be the other one. It became per-community in
 * v2-9 and moved to bootstrap.ts, for the reason the app_config defaults and the
 * automation account moved there in v2-6: seed runs before any tenant exists, so
 * a row written here takes the tenant_id sentinel and is rejected by the foreign
 * key.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Normalises a captured JSON row into something Prisma will accept.
 *
 * Two things need doing. createdAt/updatedAt are an artifact of when the
 * data was captured, not meaningful values, so they are dropped and the
 * column defaults (CURRENT_TIMESTAMP) record when this install was actually
 * seeded. And JSON has no date type, so datetime columns arrive as ISO
 * strings and have to become Date objects again.
 *
 * The return type is deliberately loose: these rows are generated from a
 * database dump rather than written by hand, so per-model input types would
 * mean seven near-identical casts without catching anything a mismatched
 * column name would not already fail on at runtime.
 */
function normalize(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'createdAt' || key === 'updatedAt') continue;
    out[key] = typeof value === 'string' && ISO_DATE.test(value) ? new Date(value) : value;
  }
  return out;
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      timezone: 'Z',
    }),
  });

  // Ordered by foreign-key dependency: cities before users (users.city_id),
  // and achievements before anything that references them.
  for (const row of cities) {
    const data = normalize(row);
    await prisma.cities.upsert({
      where: { subdomain: row.subdomain as string },
      update: data as never,
      create: data as never,
    });
  }

  for (const row of avatar) {
    const data = normalize(row);
    await prisma.avatar.upsert({
      where: { path: row.path as string },
      update: data as never,
      create: data as never,
    });
  }

  for (const row of achievements) {
    const data = normalize(row);
    await prisma.achievements.upsert({
      where: { key: row.key as string },
      update: data as never,
      create: data as never,
    });
  }

  // Single-row config tables with no natural key -- keyed on their fixed id.
  for (const row of merchConfig) {
    const data = normalize(row);
    await prisma.merch_config.upsert({
      where: { id: row.id as number },
      update: data as never,
      create: data as never,
    });
  }

  const counts = {
    cities: await prisma.cities.count(),
    avatar: await prisma.avatar.count(),
    achievements: await prisma.achievements.count(),
    merch_config: await prisma.merch_config.count(),
  };
  console.log('Seeded:', counts);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
