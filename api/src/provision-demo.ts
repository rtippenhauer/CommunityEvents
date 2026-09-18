/**
 * Creates the demo community, or re-seeds it if it already exists (v2-14).
 *
 *   ALLOW_DEMO_PROVISION=<database name> node dist/provision-demo.js
 *
 * or locally with `npm run provision-demo`.
 *
 * ## Why this is a script and not a button
 *
 * `is_demo` grants two things nothing else in the system grants: a stranger who
 * registers becomes an admin, and the community's data is destroyed on a timer.
 * Nothing reachable over HTTP can set that column — `TenantsAdminService` creates
 * communities with it unset and never updates it — so the escalation has no
 * network surface at all. A system admin can still suspend or delete the demo
 * like any other community; what they cannot do is turn an existing community
 * into one, which is the operation worth making impossible rather than merely
 * guarded.
 *
 * ## Where the demo lives
 *
 * Derived, never given: `demo.` on this deployment's own domain, so stage and
 * production each get their own without either being told about the other. That
 * shape is load-bearing, not cosmetic — see `demoDomainFor`.
 *
 * DNS and the reverse proxy still have to point that host here, and on stage
 * that host needs a grey-clouded (DNS-only) Cloudflare record: Universal SSL's
 * wildcard covers one label, so `demo.stage.<domain>` has no edge certificate and
 * the handshake aborts with what Chrome reports as
 * ERR_SSL_VERSION_OR_CIPHER_MISMATCH. NGINX Proxy Manager holds a Let's Encrypt
 * certificate for it instead. Production needs none of this: `demo.<apex>` is a
 * single label and the existing wildcard already covers it.
 */
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import { demoDomainFor, resolveRootTenantDomain } from './common/utils/tenant-domain.util';
import { DEMO_MEMBER_PASSWORD, resetDemoTenant } from './database/prisma/demo-seed';

// Same as bootstrap.ts, seed.ts and provision-tenant.ts: this runs standalone
// rather than through Nest, so nothing else populates env.
dotenv.config({ path: path.join(__dirname, '../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

/**
 * Same confirmation idiom as the other maintenance scripts: name the database
 * you mean.
 *
 * It matters more here than it does for `provision-tenant.ts`. Re-running this
 * against an existing demo **erases everything in it** — that is what a reset
 * is — so a correct-looking command pointed at the wrong DB_NAME is destructive
 * rather than merely untidy. The refusal below (a non-demo tenant already owns
 * the address) is the other half of that protection.
 */
function assertTargetConfirmed(): void {
  const target = process.env.ALLOW_DEMO_PROVISION;
  const database = required('DB_NAME');

  if (target !== database) {
    throw new Error(
      'Refusing to provision the demo: set ALLOW_DEMO_PROVISION to the database name ' +
        `you intend to write to (currently DB_NAME=${database}` +
        (target ? `, ALLOW_DEMO_PROVISION=${target}` : '') +
        ').',
    );
  }
}

async function main(): Promise<void> {
  assertTargetConfirmed();

  const deploymentDomain = resolveRootTenantDomain(process.env);
  if (!deploymentDomain) {
    throw new Error('Neither ROOT_TENANT_URL nor APP_URL is set, so the demo has no address.');
  }
  const domain = demoDomainFor(deploymentDomain);

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
    const root = await prisma.tenants.findFirst({ where: { rootMarker: true } });
    if (!root) {
      throw new Error(
        'No root tenant exists — run bootstrap.js first. The demo is a community beside the ' +
          'root one, not a replacement for it.',
      );
    }

    const existing = await prisma.tenants.findUnique({ where: { domain } });

    // An existing tenant at the demo's address that is not the demo is either a
    // community somebody created by hand there, or the root tenant on a
    // deployment whose APP_URL has drifted. Flipping the column would hand its
    // members' community an open registration door and put it on the nightly
    // wipe list; re-seeding it would erase it. Both are unrecoverable, so this
    // refuses instead of guessing which one was meant.
    if (existing && !existing.isDemo) {
      throw new Error(
        `${domain} already belongs to tenant "${existing.slug}" (#${existing.id}), which is not ` +
          'the demo. Refusing to convert an existing community into the demo — delete it first ' +
          'if that is really what you want.',
      );
    }

    const tenant =
      existing ??
      (await prisma.tenants.create({
        data: {
          slug: 'demo',
          domain,
          status: 'active',
          isDemo: true,
          // Never a root tenant, and the database agrees: chk_tenant_demo_not_root
          // rejects the combination outright.
          isRoot: false,
          rootMarker: null,
        },
      }));

    const summary = await resetDemoTenant(prisma, tenant.id);

    console.log(
      `\nDemo ready: #${tenant.id} "${tenant.slug}" -> https://${tenant.domain}\n` +
        (existing ? '  (existing demo, re-seeded)\n' : '  (created)\n') +
        (Object.keys(summary.wiped).length > 0
          ? `  Wiped: ${JSON.stringify(summary.wiped)}\n`
          : '') +
        `  Seeded ${summary.members} members, ${summary.locations} locations, ` +
        `${summary.pastEvents} past and ${summary.upcomingEvents} upcoming events, ` +
        `${summary.attended} attendances, ${summary.ratings} ratings.\n` +
        `  Seeded members all sign in with: ${DEMO_MEMBER_PASSWORD}\n` +
        '\n  Anyone registering on this host becomes an ADMIN of it, and everything in it is\n' +
        '  wiped and re-seeded nightly at 04:00 UTC.\n' +
        '\n  Point DNS and the reverse proxy at this deployment for that host, or it will never\n' +
        '  be reached. On stage the record must be grey-clouded — see this file’s header.\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
