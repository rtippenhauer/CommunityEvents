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
const appConfig = load('app_config');
const avatar = load('avatar');
const cities = load('cities');
const emailProviderConfig = load('email_provider_config');
const merchConfig = load('merch_config');
const users = load('users');

dotenv.config({ path: path.join(__dirname, '../../../../.env') });

/**
 * Reference and config data a brand-new install needs before it can function.
 *
 * v2 starts from a blank database and imports real records from production
 * separately, so this file covers only the rows the application itself
 * assumes exist -- the achievements catalogue, app_config defaults, the avatar
 * set, the automation service account -- not user-generated data.
 *
 * These rows previously arrived as INSERTs scattered across 20 of the 84
 * TypeORM migrations. Collecting them here is what makes those migrations
 * disposable: with the schema owned by a single Prisma migration, the only
 * thing the old migration history still carried was this data.
 *
 * Idempotent by design. Every table is upserted on a natural key, so running
 * it against an already-seeded database is a no-op rather than a duplicate-key
 * failure, and it can be re-run after adding new reference rows.
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

  for (const row of appConfig) {
    const data = normalize(row);
    await prisma.app_config.upsert({
      where: { configKey: row.configKey as string },
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
  for (const row of emailProviderConfig) {
    const data = normalize(row);
    await prisma.email_provider_config.upsert({
      where: { id: row.id as number },
      update: data as never,
      create: data as never,
    });
  }

  for (const row of merchConfig) {
    const data = normalize(row);
    await prisma.merch_config.upsert({
      where: { id: row.id as number },
      update: data as never,
      create: data as never,
    });
  }

  // The automation service account. Password hash is null by design: it is a
  // role-bearing account for internal jobs, never logged into directly, so
  // there is no credential here to leak. Human admins are created separately
  // by the bootstrap step, not seeded.
  for (const row of users) {
    const data = {
      ...normalize(row),
      emailVerifiedAt: new Date(),
    };
    await prisma.users.upsert({
      where: { email: row.email as string },
      update: data as never,
      create: data as never,
    });
  }

  const counts = {
    cities: await prisma.cities.count(),
    app_config: await prisma.app_config.count(),
    avatar: await prisma.avatar.count(),
    achievements: await prisma.achievements.count(),
    email_provider_config: await prisma.email_provider_config.count(),
    merch_config: await prisma.merch_config.count(),
    users: await prisma.users.count(),
  };
  console.log('Seeded:', counts);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
