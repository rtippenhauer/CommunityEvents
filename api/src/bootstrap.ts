/**
 * One-time instance bootstrap for a fresh white-label fork.
 *
 * Run AFTER migrations (`npm run prisma:deploy`) and the seed (`npm run seed`)
 * on a brand-new database. It turns the seeded DinnerBears defaults into this
 * operator's own
 * single-region instance: the root tenant, one active city, their branding, an
 * email-provider config row, and a first admin who can sign in with email +
 * password.
 *
 * The root tenant is created here rather than in prisma/seed.ts because its
 * domain is specific to this deployment -- seed.ts carries the reference data
 * every install shares, and there is no sensible instance-agnostic default for
 * a hostname. A consequence worth knowing: a database that has been migrated
 * and seeded but not bootstrapped has no tenant at all, and domain resolution
 * (REQ-TENANT-01.2) will refuse every request until this has run.
 *
 * Everything is idempotent (upserts), so re-running is safe. As a guardrail
 * against pointing it at a populated database by mistake, it refuses to run
 * when real (non-service) user accounts already exist unless
 * INSTANCE_BOOTSTRAP_FORCE=true.
 *
 * As of v2-6 this also owns two things seed.ts used to write: the `app_config`
 * defaults and the automation service account. Both belong to a tenant, and
 * seed.ts runs before any tenant exists -- see the note at the top of seed.ts.
 * The first admin is created as `system_admin`, the operator of the deployment.
 *
 * Configuration comes from env vars (see docs/NEW_INSTANCE_SETUP.md):
 *   ROOT_TENANT_URL               (optional) defaults to APP_URL; only set it
 *                                 when the root tenant's host differs from the
 *                                 app's own URL, which so far it never has
 *   ROOT_TENANT_SLUG              (optional) defaults to "root"
 *   INSTANCE_CITY_NAME            (required) e.g. "Southwest Ohio"
 *   INSTANCE_CITY_SUBDOMAIN       (optional) defaults to a slug of the name
 *   INSTANCE_BRAND_NAME           (optional) e.g. "Sons"
 *   INSTANCE_BRAND_TAGLINE        (optional)
 *   INSTANCE_THEME_PRIMARY        (optional) #RRGGBB
 *   INSTANCE_THEME_ACCENT         (optional) #RRGGBB
 *   INSTANCE_THEME_BACKGROUND     (optional) #RRGGBB
 *   INSTANCE_ADMIN_EMAIL          (required)
 *   INSTANCE_ADMIN_NAME           (optional) defaults to "Admin"
 *   INSTANCE_ADMIN_PASSWORD       (required)
 *   INSTANCE_BOOTSTRAP_FORCE      (optional) "true" to run against a non-empty DB
 *
 * Usage (local, from api/):   npm run bootstrap
 * Usage (production container): docker exec -e INSTANCE_CITY_NAME=… \
 *   -e INSTANCE_ADMIN_EMAIL=… -e INSTANCE_ADMIN_PASSWORD=… … \
 *   <api-container> node /app/dist/bootstrap.js
 * (compiled here rather than under src/scripts, which the build excludes, so
 * `node dist/bootstrap.js` is available in the devDep-pruned production image.)
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import { coerceRawRow } from './common/utils/prisma-raw.util';
import { resolveRootTenantDomain } from './common/utils/tenant-domain.util';
import { AUTOMATION_ACCOUNT_EMAIL } from './common/utils/service-account.util';
import { LEGAL_DEFAULT_ROWS } from './common/legal/legal-defaults';
import {
  createServiceAccount,
  type SqlExecutor,
} from './database/prisma/service-account.provision';

// Previously inherited from data-source.ts, which loaded this on import. This
// script runs standalone (not through Nest), so nothing else populates env.
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * The statements below are deliberately left as raw SQL rather than rewritten
 * as Prisma model calls. They lean on MySQL-specific behaviour Prisma has no
 * direct equivalent for -- ON DUPLICATE KEY UPDATE, INSERT IGNORE, CURDATE(),
 * conditional multi-row deletes -- and this is one-time provisioning code, not
 * a hot path. Every one is parameterised; none interpolates user input.
 */
// SqlExecutor lives with createServiceAccount, which both scripts share.

const BCRYPT_ROUNDS = 12;

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || !value.trim()) {
    console.error(`✗ Missing required env var: ${key}`);
    process.exit(1);
  }
  return value.trim();
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'main';
}

async function upsertSiteSetting(
  tx: SqlExecutor,
  tenantId: number,
  key: string,
  value: string | undefined,
  description: string,
): Promise<void> {
  if (value === undefined || value === '') return; // leave the seeded default in place
  await tx.$executeRawUnsafe(
    `INSERT INTO app_config (tenant_id, config_key, config_value, description)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    tenantId,
    key,
    value,
    description,
  );
  console.log(`  • ${key} = ${value}`);
}

/**
 * The runtime-config defaults for a new community.
 *
 * These moved here from seed.ts in v2-6. `app_config` is tenant-scoped now
 * (REQ-TENANT-01.4), and seed.ts runs before any tenant exists, so it has no id
 * to write them against -- whereas bootstrap has just created one.
 *
 * INSERT IGNORE, so re-running never overwrites a value the operator has since
 * edited in /admin/settings. The `?` for tenant_id is repeated per row rather
 * than the whole set being built as one multi-row VALUES list, because the row
 * count comes from a JSON file and building a variable-length statement by
 * string concatenation is how parameterisation gets lost.
 */
async function seedTenantConfigDefaults(tx: SqlExecutor, tenantId: number): Promise<number> {
  // One level up from this file, which is `api/src/` under ts-node and
  // `api/dist/` in the image -- dist mirrors src, so the same hop lands on
  // `api/` either way. (seed.ts needs three hops because it sits deeper.)
  const file = path.join(__dirname, '..', 'prisma', 'seed-data', 'app_config.json');
  const rows: {
    configKey: string;
    configValue: string;
    description?: string | null;
  }[] = [
    ...(JSON.parse(fs.readFileSync(file, 'utf8')) as {
      configKey: string;
      configValue: string;
      description?: string | null;
    }[]),
    // Terms and Privacy come from code, not from that JSON: the file is a dump
    // of one community's settings, and legal copy is the part of it that must
    // not be inherited by whoever installs this next. See legal-defaults.ts.
    ...LEGAL_DEFAULT_ROWS,
  ];

  let written = 0;
  for (const row of rows) {
    written += await tx.$executeRawUnsafe(
      `INSERT IGNORE INTO app_config (tenant_id, config_key, config_value, description)
       VALUES (?, ?, ?, ?)`,
      tenantId,
      row.configKey,
      row.configValue,
      row.description ?? null,
    );
  }
  return written;
}

async function main(): Promise<void> {
  // The root tenant's domain, from ROOT_TENANT_URL or -- normally -- APP_URL.
  // Stored bare and lower-cased so the www. and apex forms can never become two
  // rows (REQ-TENANT-01.1). See resolveRootTenantDomain for why BASE_DOMAIN is
  // not part of that chain.
  const rootTenantDomain = resolveRootTenantDomain(process.env);
  if (!rootTenantDomain) {
    console.error(
      'X Could not determine the root tenant domain. Set APP_URL (e.g.\n' +
        '  https://stage.communityeventsproject.com), or ROOT_TENANT_URL if the\n' +
        '  root tenant is served from a different host than the app itself.',
    );
    process.exit(1);
  }
  const rootTenantSlug = (process.env.ROOT_TENANT_SLUG?.trim() || 'root').toLowerCase();

  const cityName = requireEnv('INSTANCE_CITY_NAME');
  const citySubdomain = (process.env.INSTANCE_CITY_SUBDOMAIN || slugify(cityName)).toLowerCase();
  const adminEmail = requireEnv('INSTANCE_ADMIN_EMAIL').toLowerCase();
  const adminName = process.env.INSTANCE_ADMIN_NAME?.trim() || 'Admin';
  const adminPassword = requireEnv('INSTANCE_ADMIN_PASSWORD');
  const force = process.env.INSTANCE_BOOTSTRAP_FORCE === 'true';

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

  try {
    // ── Guardrail ───────────────────────────────────────────────────────────
    // Raw queries hand integer columns back as BigInt under the Prisma
    // adapter; coerceRawRow normalises them to the numbers this code declares.
    const [{ n }] = (
      await prisma.$queryRawUnsafe<[{ n: number }]>(
        `SELECT COUNT(*) AS n FROM users WHERE is_service_account = 0`,
      )
    ).map(coerceRawRow) as [{ n: number }];
    if (n > 0 && !force) {
      console.error(
        `✗ This database already has ${n} real user account(s). Refusing to ` +
          `bootstrap so a live instance is never clobbered.\n` +
          `  If you really mean to (re)bootstrap this database, set ` +
          `INSTANCE_BOOTSTRAP_FORCE=true and run again.`,
      );
      process.exit(1);
    }

    // One interactive transaction: everything below commits together or not
    // at all, and throwing rolls back without an explicit rollback call.
    await prisma.$transaction(async (tx) => {

    // ── Root tenant ─────────────────────────────────────────────────────────
    // is_root and root_marker are always written together. root_marker is
    // `true` here and NULL on every other tenant, and its unique index is what
    // makes "exactly one root" a database guarantee rather than a convention --
    // a second root tenant would mean a second system admin.
    console.log(`\nRoot tenant:`);
    await tx.$executeRawUnsafe(
      `INSERT INTO tenants (slug, domain, is_root, root_marker, status, db_mode)
       VALUES (?, ?, 1, 1, 'active', 'shared')
       ON DUPLICATE KEY UPDATE domain = VALUES(domain), status = 'active'`,
      rootTenantSlug,
      rootTenantDomain,
    );
    const [tenantRow] = (
      await tx.$queryRawUnsafe<[{ id: number }]>(
        `SELECT id FROM tenants WHERE slug = ?`,
        rootTenantSlug,
      )
    ).map(coerceRawRow) as [{ id: number }];
    console.log(`  - ${rootTenantDomain} (slug "${rootTenantSlug}", id ${tenantRow.id})`);

    // ── City: one active city for this single-region instance ───────────────
    console.log(`\nCity:`);
    await tx.$executeRawUnsafe(
      `INSERT INTO cities (name, subdomain, is_active)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
      cityName,
      citySubdomain,
    );
    const [cityRow] = (
      await tx.$queryRawUnsafe<[{ id: number }]>(
        `SELECT id FROM cities WHERE subdomain = ?`,
        citySubdomain,
      )
    ).map(coerceRawRow) as [{ id: number }];
    const cityId = cityRow.id;
    // Deactivate any other cities (e.g. the seeded Cincinnati/Dayton defaults)
    // so the single-city UX + root-domain fallback kick in. Deactivated, not
    // deleted, to keep any existing FK references (e.g. the automation user)
    // valid.
    // $executeRawUnsafe returns the affected-row count directly, where TypeORM
    // handed back a ResultSetHeader to read .affectedRows from.
    const deactivated = await tx.$executeRawUnsafe(
      `UPDATE cities SET is_active = 0 WHERE id <> ?`,
      cityId,
    );
    console.log(`  • ${cityName} (${citySubdomain}) → active [id ${cityId}]`);
    if (deactivated) {
      console.log(`  • deactivated ${deactivated} other city row(s)`);
    }

    // ── Runtime config defaults ─────────────────────────────────────────────
    // Written before the branding overrides below, which edit these same rows.
    const configRows = await seedTenantConfigDefaults(tx, tenantRow.id);
    if (configRows) {
      console.log(`
Config:
  • seeded ${configRows} default setting(s)`);
    }

    // ── Branding (only overrides values the operator provided) ──────────────
    console.log(`\nBranding:`);
    await upsertSiteSetting(tx, tenantRow.id, 'brand_name', process.env.INSTANCE_BRAND_NAME?.trim(),
      'App name shown in nav, footer, and page titles');
    await upsertSiteSetting(tx, tenantRow.id, 'brand_tagline', process.env.INSTANCE_BRAND_TAGLINE?.trim(),
      'Short tagline shown on the login page and footer');
    await upsertSiteSetting(tx, tenantRow.id, 'theme_color_primary', process.env.INSTANCE_THEME_PRIMARY?.trim(),
      'Primary brand color (buttons, links, accents)');
    await upsertSiteSetting(tx, tenantRow.id, 'theme_color_accent', process.env.INSTANCE_THEME_ACCENT?.trim(),
      'Secondary accent color');
    await upsertSiteSetting(tx, tenantRow.id, 'theme_color_background', process.env.INSTANCE_THEME_BACKGROUND?.trim(),
      'Page background color');

    // ── Avatars: clear the seeded DinnerBears bear set ──────────────────────
    // The CreateAvatarsTable migration seeds 32 bear presets so DinnerBears is
    // unchanged, but a fresh fork (esp. a non-bear group) shouldn't inherit
    // them — it uploads its own set in /admin/avatars. Only removes the static
    // bear defaults, never any avatars this instance already uploaded.
    const clearedAvatars = await tx.$executeRawUnsafe(
      `DELETE FROM avatar WHERE path LIKE '/avatars/bear-%'`,
    );
    if (clearedAvatars) {
      console.log(`\nAvatars:\n  • cleared ${clearedAvatars} default bear avatar(s)`);
    }

    // Clear DinnerBears' seeded home-page story image + hero copy so a fresh
    // fork shows its own (or the generic branded fallback) rather than
    // DinnerBears' map and "weekly dinners" wording.
    await tx.$executeRawUnsafe(
      `UPDATE app_config SET config_value = ''
       WHERE tenant_id = ?
         AND config_key IN ('brand_story_url', 'home_hero_html', 'home_howitworks_html')`,
      tenantRow.id,
    );

    // Delete DinnerBears' seeded terminology rows so a fresh fork falls back to
    // the generic code defaults (Restaurant / Event / Points). These must be
    // DELETEd, not blanked — getSiteSetting only falls back to the default on a
    // missing row, so an empty value would leave the UI with no term at all.
    // The operator renames them afterwards in /admin/settings → Terminology.
    const clearedTerms = await tx.$executeRawUnsafe(
      `DELETE FROM app_config
       WHERE tenant_id = ?
         AND config_key IN ('term_location_singular', 'term_location_plural',
           'term_dinner_singular', 'term_dinner_plural', 'term_points')`,
      tenantRow.id,
    );
    if (clearedTerms) {
      console.log(`  • cleared ${clearedTerms} seeded terminology row(s)`);
    }

    // ── Email provider config (leave an existing configured row untouched) ──
    await tx.$executeRawUnsafe(
      `INSERT IGNORE INTO email_provider_config
         (id, brevo_enabled, resend_overflow_enabled, brevo_daily_limit,
          resend_daily_limit, brevo_sent_today, resend_sent_today, last_reset_date)
       VALUES (1, 1, 0, 300, 1000, 0, 0, CURDATE())`,
    );

    // ---- Service account -------------------------------------------------
    // The root tenant's, so role `automation`. Created before the admin because
    // system writes (release-notes import in particular) attribute to it.
    await createServiceAccount(tx, tenantRow.id, cityId);
    console.log(`
Service account:
  - ${AUTOMATION_ACCOUNT_EMAIL} (automation)`);

    // ---- First admin (email + password) -----------------------------------
    // `system_admin`, not `admin`: this is the root tenant, and its admin is the
    // operator of the whole deployment (REQ-TENANT-01.7). The role satisfies
    // @Roles(ADMIN) through RolesGuard's hierarchy, so it loses nothing an
    // ordinary admin can do and additionally reaches the tenant registry at
    // /admin/tenants. Nothing else grants it -- admin.service.setRole refuses to
    // assign or remove the role at all -- so this is the only place it is made.
    //
    // The lookup is scoped to the tenant: email is unique per tenant now, so the
    // same address in another community is a different account and must not be
    // found here.
    console.log(`
Admin:`);
    const [existing] = (
      await tx.$queryRawUnsafe<{ id: number }[]>(
        `SELECT id FROM users WHERE tenant_id = ? AND email = ?`,
        tenantRow.id,
        adminEmail,
      )
    ).map(coerceRawRow) as ({ id: number } | undefined)[];
    if (existing) {
      await tx.$executeRawUnsafe(
        `UPDATE users SET role = 'system_admin', status = 'active' WHERE id = ?`,
        existing.id,
      );
      console.log(
        `  - ${adminEmail} already existed, ensured system admin role (password unchanged)`,
      );
    } else {
      const hash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS);
      await tx.$executeRawUnsafe(
        `INSERT INTO users
           (tenant_id, full_name, email, email_status, email_verified_at,
            password_hash, city_id, role, status)
         VALUES (?, ?, ?, 'active', NOW(), ?, ?, 'system_admin', 'active')`,
        tenantRow.id,
        adminName,
        adminEmail,
        hash,
        cityId,
      );
      console.log(`  - created system admin ${adminEmail}`);
    }
    });

    console.log(`\n✓ Bootstrap complete. Sign in at your instance with ${adminEmail}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('✗ Bootstrap failed:', err);
  process.exit(1);
});
