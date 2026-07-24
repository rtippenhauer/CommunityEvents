/**
 * One-time instance bootstrap for a fresh white-label fork.
 *
 * Run AFTER migrations (`npm run migration:run`) on a brand-new database. It
 * turns the migration-seeded DinnerBears defaults into this operator's own
 * single-region instance: one active city, their branding, an email-provider
 * config row, and a first admin who can sign in with email + password.
 *
 * Everything is idempotent (upserts), so re-running is safe. As a guardrail
 * against pointing it at a populated database by mistake, it refuses to run
 * when non-automation users already exist unless INSTANCE_BOOTSTRAP_FORCE=true.
 *
 * Configuration comes from env vars (see docs/NEW_INSTANCE_SETUP.md):
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
import 'reflect-metadata';
import * as bcrypt from 'bcrypt';
import dataSource from './database/data-source';
import type { QueryRunner } from 'typeorm';

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
  qr: QueryRunner,
  key: string,
  value: string | undefined,
  description: string,
): Promise<void> {
  if (value === undefined || value === '') return; // leave the migration default in place
  await qr.query(
    `INSERT INTO app_config (config_key, config_value, description)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
    [key, value, description],
  );
  console.log(`  • ${key} = ${value}`);
}

async function main(): Promise<void> {
  const cityName = requireEnv('INSTANCE_CITY_NAME');
  const citySubdomain = (process.env.INSTANCE_CITY_SUBDOMAIN || slugify(cityName)).toLowerCase();
  const adminEmail = requireEnv('INSTANCE_ADMIN_EMAIL').toLowerCase();
  const adminName = process.env.INSTANCE_ADMIN_NAME?.trim() || 'Admin';
  const adminPassword = requireEnv('INSTANCE_ADMIN_PASSWORD');
  const force = process.env.INSTANCE_BOOTSTRAP_FORCE === 'true';

  await dataSource.initialize();
  const qr = dataSource.createQueryRunner();
  await qr.connect();

  try {
    // ── Guardrail ───────────────────────────────────────────────────────────
    const [{ n }] = (await qr.query(
      `SELECT COUNT(*) AS n FROM users WHERE role <> 'automation'`,
    )) as [{ n: number }];
    if (Number(n) > 0 && !force) {
      console.error(
        `✗ This database already has ${n} non-automation user(s). Refusing to ` +
          `bootstrap so a live instance is never clobbered.\n` +
          `  If you really mean to (re)bootstrap this database, set ` +
          `INSTANCE_BOOTSTRAP_FORCE=true and run again.`,
      );
      process.exit(1);
    }

    await qr.startTransaction();

    // ── City: one active city for this single-region instance ───────────────
    console.log(`\nCity:`);
    await qr.query(
      `INSERT INTO cities (name, subdomain, is_active)
       VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = 1`,
      [cityName, citySubdomain],
    );
    const [cityRow] = (await qr.query(`SELECT id FROM cities WHERE subdomain = ?`, [
      citySubdomain,
    ])) as [{ id: number }];
    const cityId = cityRow.id;
    // Deactivate any other cities (e.g. the seeded Cincinnati/Dayton defaults)
    // so the single-city UX + root-domain fallback kick in. Deactivated, not
    // deleted, to keep any existing FK references (e.g. the automation user)
    // valid.
    const deactivated = (await qr.query(`UPDATE cities SET is_active = 0 WHERE id <> ?`, [
      cityId,
    ])) as { affectedRows?: number };
    console.log(`  • ${cityName} (${citySubdomain}) → active [id ${cityId}]`);
    if (deactivated.affectedRows) {
      console.log(`  • deactivated ${deactivated.affectedRows} other city row(s)`);
    }

    // ── Branding (only overrides values the operator provided) ──────────────
    console.log(`\nBranding:`);
    await upsertSiteSetting(qr, 'brand_name', process.env.INSTANCE_BRAND_NAME?.trim(),
      'App name shown in nav, footer, and page titles');
    await upsertSiteSetting(qr, 'brand_tagline', process.env.INSTANCE_BRAND_TAGLINE?.trim(),
      'Short tagline shown on the login page and footer');
    await upsertSiteSetting(qr, 'theme_color_primary', process.env.INSTANCE_THEME_PRIMARY?.trim(),
      'Primary brand color (buttons, links, accents)');
    await upsertSiteSetting(qr, 'theme_color_accent', process.env.INSTANCE_THEME_ACCENT?.trim(),
      'Secondary accent color');
    await upsertSiteSetting(qr, 'theme_color_background', process.env.INSTANCE_THEME_BACKGROUND?.trim(),
      'Page background color');

    // ── Email provider config (leave an existing configured row untouched) ──
    await qr.query(
      `INSERT IGNORE INTO email_provider_config
         (id, brevo_enabled, resend_overflow_enabled, brevo_daily_limit,
          resend_daily_limit, brevo_sent_today, resend_sent_today, last_reset_date)
       VALUES (1, 1, 0, 300, 1000, 0, 0, CURDATE())`,
    );

    // ── First admin (email + password) ──────────────────────────────────────
    console.log(`\nAdmin:`);
    const [existing] = (await qr.query(`SELECT id FROM users WHERE email = ?`, [adminEmail])) as [
      { id: number } | undefined,
    ];
    if (existing) {
      await qr.query(
        `UPDATE users SET role = 'admin', status = 'active' WHERE id = ?`,
        [existing.id],
      );
      console.log(`  • ${adminEmail} already existed → ensured admin role (password unchanged)`);
    } else {
      const hash = await bcrypt.hash(adminPassword, BCRYPT_ROUNDS);
      await qr.query(
        `INSERT INTO users
           (full_name, email, email_status, email_verified_at, password_hash, city_id, role, status)
         VALUES (?, ?, 'active', NOW(), ?, ?, 'admin', 'active')`,
        [adminName, adminEmail, hash, cityId],
      );
      console.log(`  • created admin ${adminEmail}`);
    }

    await qr.commitTransaction();
    console.log(`\n✓ Bootstrap complete. Sign in at your instance with ${adminEmail}.`);
  } catch (err) {
    if (qr.isTransactionActive) await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✗ Bootstrap failed:', err);
  process.exit(1);
});
