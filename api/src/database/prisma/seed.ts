import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.join(__dirname, '../../../../.env') });

/**
 * Tenant-independent reference data a brand-new install needs before it can
 * function -- **of which there is currently none.**
 *
 * This file still runs, still has its place in the install order
 * (`migrate deploy` -> `seed.js` -> `bootstrap.js`, see
 * `docs/NEW_INSTANCE_SETUP.md`) and still writes nothing, because every row it
 * used to write turned out to belong to a community rather than to the
 * deployment. In order: the `app_config` defaults and the automation account
 * left in v2-6, `email_provider_config` in v2-9, the achievement catalogue in
 * v2-10, the city list in v2-24, and `avatar` and `merch_config` in v2-47.
 * Each went to `bootstrap.ts` and `tenants-admin.service.create`, which run
 * after a tenant exists.
 *
 * **That is a pattern, not a coincidence, and it is the reason this file is
 * worth keeping empty rather than deleting.** Everything written here is
 * written into a database with zero tenant rows, so it *looks* deployment-wide
 * whether or not it is -- a row that belongs to one community takes the
 * `tenant_id` sentinel 0 here and is rejected by that table's foreign key. The
 * emptiness is the safeguard: anything added back has to answer "does a row of
 * this belong to one community, or to the deployment?" out loud, and five
 * items running have answered "one community" every time.
 *
 * It keeps a working database connection so that the next genuinely
 * tenant-independent row has somewhere to go, and so a fresh install's console
 * output still shows the step it documented.
 */
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

  await prisma.$connect();
  console.log('Seeded: nothing — no tenant-independent reference data remains (v2-47).');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
