/**
 * Runs the install steps that come after `prisma migrate deploy`, conditionally
 * and unattended.
 *
 * The point is to make provisioning behave the way migrations already do: safe
 * to run on every container start, doing nothing when there is nothing to do.
 * That property is what makes `migrate deploy` safe in an entrypoint, and none
 * of the scripts it orchestrates have it on their own —
 *
 *   - `seed.js` upserts reference data, so running it unconditionally rewrites
 *     `app_config` rows an operator has since edited through the admin UI. Every
 *     restart would silently revert their branding.
 *   - `bootstrap.js` writes the root tenant with `ON DUPLICATE KEY UPDATE domain
 *     = VALUES(domain)`, so running it unconditionally resets that domain from
 *     `APP_URL` on every boot. That is not hypothetical: a stale `APP_URL` is
 *     exactly how stage came up unresolvable on the v2-4 deploy.
 *
 * So each step is gated on a first-install condition rather than simply invoked.
 * A deployment that has already been set up runs no writes at all.
 *
 * Off by default. `AUTO_PROVISION=true` opts in, because turning a manual,
 * once-per-lifetime install into an automatic one changes what a restart can do
 * to a live deployment, and that should be a decision rather than a surprise
 * inherited from an image upgrade.
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';

/** Where the compiled siblings live, relative to this file, in the image. */
const DIST = __dirname;

function log(message: string): void {
  console.log(`[provision] ${message}`);
}

/**
 * Runs a compiled script as a child process.
 *
 * Child process rather than import, because seed.ts and bootstrap.ts each call
 * `main()` at module load and `process.exit()` on failure — importing them would
 * mean a failed seed takes this process down before the later steps report
 * anything, and there would be no way to distinguish which step exited.
 */
function run(label: string, script: string, env: NodeJS.ProcessEnv = {}): boolean {
  log(`${label}...`);
  const result = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });

  if (result.status === 0) {
    log(`${label} complete.`);
    return true;
  }
  log(`WARNING: ${label} failed (exit ${String(result.status)}).`);
  return false;
}

async function main(): Promise<void> {
  if (process.env.AUTO_PROVISION !== 'true') {
    log('AUTO_PROVISION is not "true" — skipping. Nothing was written.');
    return;
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

  let needsSeed: boolean;
  let needsBootstrap: boolean;

  try {
    // "Has this database ever been seeded?" — cities is the first thing seed.js
    // writes and nothing else creates one, so an empty table means a fresh
    // install rather than an operator who deleted their reference data.
    needsSeed = (await prisma.cities.count()) === 0;

    // "Has this deployment ever been bootstrapped?" — the root tenant is what
    // bootstrap creates and the database permits exactly one, so its absence is
    // an unambiguous first-install signal. Checking this rather than re-running
    // bootstrap is what stops APP_URL from clobbering a corrected domain.
    needsBootstrap = (await prisma.tenants.count()) === 0;
  } finally {
    await prisma.$disconnect();
  }

  if (!needsSeed && !needsBootstrap) {
    log('Already seeded and bootstrapped — nothing to do.');
    return;
  }

  // Order matters and is not negotiable: bootstrap edits seeded rows, so
  // seeding afterwards would put the DinnerBears defaults back.
  if (needsSeed) {
    if (!run('Seeding reference data', path.join(DIST, 'database', 'prisma', 'seed.js'))) return;
  } else {
    log('Reference data already present — skipping seed.');
  }

  if (needsBootstrap) {
    run('Bootstrapping root tenant and first admin', path.join(DIST, 'bootstrap.js'));
  } else {
    log('Root tenant already exists — skipping bootstrap.');
  }
}

main().catch((error) => {
  // Never take the container down. The entrypoint starts the app regardless, and
  // a deployment that is up with a loud provisioning error in its log is far
  // easier to diagnose than one that restart-loops — TenantMiddleware already
  // reports an unbootstrapped database as a 503 with a specific reason.
  console.error('[provision] ERROR:', error instanceof Error ? error.message : error);
});
