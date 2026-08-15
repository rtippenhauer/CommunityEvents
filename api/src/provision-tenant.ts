/**
 * Creates or updates a non-root tenant.
 *
 * The eventual home for this is a system-admin UI; until that exists there has
 * to be *some* supported way to add a community, and hand-written SQL is the
 * alternative — which is how the root tenant ended up holding a stale domain
 * after the stage move. This at least routes the work through the same
 * normalisation the middleware uses.
 *
 *   ALLOW_TENANT_PROVISION=<database name> \
 *   TENANT_DOMAIN=example.communityeventsproject.com \
 *   TENANT_SLUG=example \
 *   node dist/provision-tenant.js
 *
 * Deliberately cannot create a root tenant. `bootstrap.ts` owns that, the
 * database permits exactly one, and a second would mean a second system admin —
 * so `is_root`/`root_marker` are written as false/NULL here with no way to
 * override them. Changing which tenant is root is a schema-level operation, not
 * something a provisioning script should be able to do by accident.
 */
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import { normalizeTenantDomain } from './common/utils/tenant-domain.util';
import { createServiceAccount } from './database/prisma/service-account.provision';

// Same as bootstrap.ts and seed.ts: this runs standalone rather than through
// Nest, so nothing else populates env. A container passes DB_* in directly and
// this is a no-op there; locally it is what makes `npm run provision-tenant`
// work at all.
dotenv.config({ path: path.join(__dirname, '../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

/**
 * Same confirmation idiom as the test-data seeder: name the database you mean.
 *
 * Adding a tenant is not destructive, but it *is* routing — a domain pointed at
 * the wrong deployment either starts serving a community that should not exist
 * there, or shadows one that should. Cheap to confirm, tedious to unpick.
 */
function assertTargetConfirmed(): void {
  const target = process.env.ALLOW_TENANT_PROVISION;
  const database = required('DB_NAME');

  if (target !== database) {
    throw new Error(
      'Refusing to provision a tenant: set ALLOW_TENANT_PROVISION to the database name ' +
        `you intend to write to (currently DB_NAME=${database}` +
        (target ? `, ALLOW_TENANT_PROVISION=${target}` : '') +
        ').',
    );
  }
}

async function main(): Promise<void> {
  assertTargetConfirmed();

  // Normalised through the same function bootstrap and the Host-header
  // middleware use, so a tenant provisioned here resolves by exactly the rule
  // that will later look it up. A `www.` prefix is stripped rather than
  // rejected: `www.x` and `x` are one tenant, and the column cannot hold the
  // prefix anyway.
  const domain = normalizeTenantDomain(required('TENANT_DOMAIN'));
  if (!domain || !domain.includes('.')) {
    throw new Error(`TENANT_DOMAIN=${process.env.TENANT_DOMAIN} is not a usable host.`);
  }

  const slug = (process.env.TENANT_SLUG ?? domain.split('.')[0]).toLowerCase();
  if (!/^[a-z0-9-]{1,50}$/.test(slug)) {
    throw new Error(`TENANT_SLUG=${slug} must be 1-50 characters of a-z, 0-9 or "-".`);
  }

  const status = process.env.TENANT_STATUS ?? 'active';
  if (status !== 'active' && status !== 'suspended') {
    throw new Error(`TENANT_STATUS=${status} must be "active" or "suspended".`);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      allowPublicKeyRetrieval: true,
      timezone: 'Z',
    }),
  });

  try {
    const existingRoot = await prisma.tenants.findFirst({ where: { rootMarker: true } });
    if (!existingRoot) {
      throw new Error(
        'No root tenant exists — run bootstrap.js first. Provisioning a second tenant into a ' +
          'deployment with no root would leave it with no system admin.',
      );
    }
    if (existingRoot.domain === domain) {
      throw new Error(
        `${domain} is already the root tenant ("${existingRoot.slug}"). Use bootstrap.js to ` +
          'change the root tenant’s domain; this script only manages non-root tenants.',
      );
    }

    const tenant = await prisma.tenants.upsert({
      where: { domain },
      create: {
        slug,
        domain,
        status,
        // Never a root tenant. See the file comment.
        isRoot: false,
        rootMarker: null,
      },
      // Domain is the key, so it is not in the patch; slug and status are the
      // only things a re-run is allowed to change.
      update: { slug, status },
    });

    // Every tenant owns exactly one service account, created with the tenant --
    // see createServiceAccount. A non-root tenant's holds `disabled`, which
    // satisfies no @Roles(): the row exists so the deployment has something to
    // attribute its own writes to, not so anything can sign in as it.
    //
    // `users.city_id` is NOT NULL and `cities` is a global model, so any city
    // serves; the field is meaningless for a service account. Ordering by id
    // keeps a re-run deterministic.
    const city = await prisma.cities.findFirst({ orderBy: { id: 'asc' } });
    if (!city) {
      throw new Error('No city exists -- run the seed step before provisioning a tenant.');
    }
    await createServiceAccount(prisma, tenant.id, city.id, false);

    console.log(
      `\nTenant ready: #${tenant.id} "${tenant.slug}" -> ${tenant.domain} (${tenant.status})\n` +
        '  Service account created (disabled role).\n' +
        '  Point DNS and the reverse proxy at this deployment for that host, or it will never ' +
        'be reached.\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
