/**
 * Imports a complete DinnerBears (v1) database into a new CommunityEvents
 * tenant (REQ-IMPORT-01, v2-25).
 *
 *   SOURCE_DATABASE_URL=mysql://readonly:pw@host:3306/dinnerbears \
 *   TENANT_SLUG=dinnerbears \
 *   TENANT_DOMAIN=www.dinnerbears.com \
 *   ALLOW_IMPORT=<target database name> \
 *   npm run import:dinnerbears -- --dry-run
 *
 * **Run it with `--dry-run` first, against a copy, and read the counts.** The
 * dry run reads every row, resolves every foreign key and reports what it would
 * write, without writing anything — which makes it the cheapest way to find out
 * that a column drifted or that the source holds orphaned rows. On a community
 * of 62 members it takes seconds, so there is no reason to skip it.
 *
 * Flags:
 *   --dry-run                  Report and write nothing.
 *   --explain                  Print every deliberate exclusion and its reason.
 *   --with-email-credentials   Also import the Brevo and Resend API keys.
 *                              Default OFF: the rehearsal runs live member data
 *                              on stage, where the point is that it cannot mail
 *                              real members. See docs/CUTOVER_PLAN.md — this is
 *                              not the only guard, and deliberately so.
 *
 * Deliberately a manually-triggered script taking an explicit connection string
 * rather than anything that runs at boot (REQ-IMPORT-01.1). It is the
 * highest-consequence one-time operation in the project; nothing about it should
 * be capable of happening by accident.
 */
import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import { secretEncryptionExtension } from './database/prisma/secret-encryption.extension';
import { tenantScopeExtension } from './database/prisma/tenant-scope.extension';
import { normalizeTenantDomain } from './common/utils/tenant-domain.util';
import { formatExclusions, formatRunReport } from './import/report';
import { formatPreflight, preflight } from './import/preflight';
import { runImport } from './import/runner';
import { SourceReader } from './import/source-reader';
import { formatValidation, validate } from './import/validate';

// Same as bootstrap.ts and provision-tenant.ts: this runs standalone rather
// than through Nest, so nothing else populates env.
dotenv.config({ path: path.join(__dirname, '../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

/**
 * Name the database you mean, as `provision-tenant.ts` and the test-data seeder
 * both do.
 *
 * Stronger grounds here than in either of those: this writes tens of thousands
 * of rows to whichever database `DB_NAME` happens to point at, and the usual way
 * to get that wrong is a shell that still has stage's environment loaded. The
 * check costs one variable and makes the target an explicit statement rather
 * than a leftover.
 */
function assertTargetConfirmed(): void {
  const target = process.env.ALLOW_IMPORT;
  const database = required('DB_NAME');
  if (target !== database) {
    throw new Error(
      'Refusing to import: set ALLOW_IMPORT to the name of the database you intend to write ' +
        `to (currently DB_NAME=${database}` +
        (target ? `, ALLOW_IMPORT=${target}` : '') +
        ').',
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const explain = argv.includes('--explain');
  const withEmailCredentials = argv.includes('--with-email-credentials');

  const unknown = argv.filter(
    (arg) => !['--dry-run', '--explain', '--with-email-credentials'].includes(arg),
  );
  if (unknown.length > 0) {
    // Refused rather than ignored: a mistyped `--dry-run` that is silently
    // dropped turns the safe invocation into the real one.
    throw new Error(
      `Unrecognised argument(s): ${unknown.join(', ')}. Did you mean --dry-run? Refusing to ` +
        'continue, because a mistyped --dry-run would otherwise run for real.',
    );
  }

  if (explain) console.log(formatExclusions());

  const slug = required('TENANT_SLUG').toLowerCase();
  if (!/^[a-z0-9-]{1,50}$/.test(slug)) {
    throw new Error(`TENANT_SLUG=${slug} must be 1-50 characters of a-z, 0-9 or "-".`);
  }

  // Normalised through the same function the Host-header middleware uses, so
  // the imported community resolves by exactly the rule that will look it up. A
  // `www.` prefix is stripped rather than rejected: the column cannot hold it,
  // and `www.dinnerbears.com` is how this one will be typed.
  const domain = normalizeTenantDomain(required('TENANT_DOMAIN'));
  if (!domain || !domain.includes('.')) {
    throw new Error(`TENANT_DOMAIN=${process.env.TENANT_DOMAIN} is not a usable host.`);
  }

  if (!dryRun) assertTargetConfirmed();

  const source = await SourceReader.open(required('SOURCE_DATABASE_URL'));

  // The extended client, not the bare one. The scoping extension injects
  // `tenant_id` on every write, which is what keeps roughly forty tables from
  // depending on this script remembering; the encryption extension handles the
  // stored credentials. bootstrap.ts uses a bare client because it writes the
  // root tenant before scoping can mean anything — that reasoning does not
  // apply here.
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
  })
    .$extends(tenantScopeExtension)
    .$extends(secretEncryptionExtension) as unknown as PrismaClient;

  try {
    console.log(
      `\nSource:  ${source.database}\n` +
        `Target:  ${String(process.env.DB_NAME)} — new tenant "${slug}" -> ${domain}\n` +
        `Mode:    ${dryRun ? 'DRY RUN (nothing is written)' : 'LIVE'}\n` +
        `Email:   ${withEmailCredentials ? 'credentials WILL be imported' : 'credentials withheld'}\n`,
    );

    // The source is supposed to be read-only, and a connection string saying so
    // is not the same as a credential that is. Checked against the server
    // before anything else, because the live community database is on the other
    // end of it.
    await source.assertReadOnly();

    // Then the schema, before a single row is read: a column the plan does not
    // account for is one this import would drop in silence.
    const result = preflight(await source.describe());
    console.log(formatPreflight(result));
    if (!result.ok) {
      throw new Error(
        'Preflight failed: the source schema and the import plan disagree. Nothing was read ' +
          'or written. Resolve each error above — every one of them is a column or table ' +
          'whose handling nobody has decided.',
      );
    }

    const report = await runImport(prisma, source, {
      slug,
      domain,
      dryRun,
      withEmailCredentials,
    });
    console.log(formatRunReport(report));

    if (dryRun) {
      console.log(
        'Dry run only. Compare the counts above against the source, read the skip reasons, ' +
          'then re-run without --dry-run.\n',
      );
      return;
    }

    const validation = await validate(prisma, report.tenantId as number, report);
    console.log(formatValidation(validation));
    console.log('');

    if (!validation.ok) {
      throw new Error(
        'The import completed but validation failed. The tenant exists and holds data — read ' +
          'the errors above and decide whether to fix it in place or delete the community and ' +
          're-import. Re-running against this same target will be refused.',
      );
    }

    console.log(
      `Tenant #${String(report.tenantId)} "${slug}" -> ${domain} is imported and validated.\n` +
        '  Point DNS and the reverse proxy at this deployment for that host.\n' +
        (withEmailCredentials
          ? ''
          : '  No email credentials were imported: set them in Admin -> Email before go-live.\n') +
        '  Web push needs this deployment to carry v1 VAPID keys — see docs/CUTOVER_PLAN.md.\n',
    );
  } finally {
    await source.close();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
