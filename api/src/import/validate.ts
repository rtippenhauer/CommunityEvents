import { PrismaClient } from '@prisma/client';
import { runUnscoped, runWithTenant } from '../common/tenant/tenant-store';
import { hasAdminRights } from '../common/utils/roles.util';
import { TENANT_SCOPED_MODELS } from '../common/tenant/tenant-scoped-models';
import { modelDelegate } from './runner';
import type { RunReport } from './runner';

/**
 * The post-import checks (REQ-IMPORT-01.5).
 *
 * Three questions, and the third is the one that cannot be answered by counting:
 *
 *  1. Do the row counts match the source, minus what was explicitly excluded or
 *     skipped?
 *  2. Do sampled foreign-key chains resolve inside the new tenant?
 *  3. Does any imported row reference an id outside it?
 *
 * The third is the failure this whole import is shaped to avoid and the hardest
 * to find afterwards, because nothing surfaces it: a foreign key to another
 * community's row reads as valid to MySQL and renders as somebody else's
 * content. It is checked by counting each scoped table *inside* the tenant and
 * comparing against what the import claims to have written — a row that landed
 * in the wrong tenant is missing from this count.
 */

export interface ValidationFinding {
  readonly severity: 'error' | 'warning';
  readonly message: string;
}

export interface ValidationResult {
  readonly findings: readonly ValidationFinding[];
  readonly ok: boolean;
}

export async function validate(
  prisma: PrismaClient,
  tenantId: number,
  report: RunReport,
): Promise<ValidationResult> {
  const findings: ValidationFinding[] = [];

  // 1: the arithmetic has to close. Every source row was either written or
  // skipped for a stated reason; a row that is neither is one the import lost
  // without noticing, which is the failure a count comparison exists to catch.
  //
  // `nulled` is deliberately not in this sum. A blanked nullable foreign key
  // leaves the row written, so counting it here made a correct import of the
  // live community fail: 32 events in, 32 written, 14 with a null coordinator.
  // See TableResult.
  for (const table of report.tables) {
    const expected = table.imported;
    if (expected === 0) continue;

    const skippedTotal = table.skipped.reduce((sum, s) => sum + s.count, 0);
    if (table.sourceRows !== expected + skippedTotal) {
      findings.push({
        severity: 'error',
        message:
          `${table.source}: the source holds ${table.sourceRows} row(s), the import wrote ` +
          `${expected} and skipped ${skippedTotal}. Those do not add up, so some rows were ` +
          'neither written nor accounted for.',
      });
    }
  }

  // 3: every scoped model's row count, read from *inside* the tenant. The
  // scoping extension adds the predicate, so a row written against the wrong
  // tenant is simply absent from these numbers — which is what makes a count
  // here an answer to "did anything land outside the community" and not just a
  // tally.
  const counts = await runWithTenant(tenantId, async () => {
    const out = new Map<string, number>();
    for (const model of TENANT_SCOPED_MODELS) {
      out.set(model, await modelDelegate(prisma, model).count());
    }
    return out;
  });

  // A scoped model holding rows that this import never wrote. On a tenant the
  // import created seconds ago, nothing else should have put anything in it —
  // so a surprise here is either a seed that ran when it should not have, or a
  // row that landed in this tenant from somewhere else.
  const touched = new Set(
    report.tables.flatMap((t) => (t.imported > 0 ? [t.source] : [])),
  );
  // user_city_preferences and app_config's feature flag come from the backfill
  // passes rather than from a source table of the same name.
  for (const pass of report.backfills) {
    if (pass.rows > 0) touched.add(pass.name.split('.')[0]);
  }
  for (const [model, count] of counts) {
    if (count === 0 || touched.has(model)) continue;
    findings.push({
      severity: 'warning',
      message:
        `${model} holds ${count} row(s) in this community, and the import wrote none. On a ` +
        'freshly created tenant that should not happen — check what else wrote them.',
    });
  }

  // 2: sampled foreign-key chains, the three REQ-IMPORT-01.5 names. Each is
  // read from inside the tenant and its relation followed, so a chain that
  // crosses out of the tenant comes back as a missing relation rather than as a
  // row from elsewhere.
  await runWithTenant(tenantId, async () => {
    const rsvp = await prisma.event_rsvps.findFirst({ include: { event: true, user: true } });
    if (rsvp && (!rsvp.event || !rsvp.user)) {
      findings.push({
        severity: 'error',
        message:
          `event_rsvps#${rsvp.id} does not resolve to both an event and a user inside this ` +
          'tenant. A foreign key points outside the community.',
      });
    }

    const earned = await prisma.member_achievements.findFirst({
      include: { achievement: true, member: true },
    });
    if (earned && (!earned.achievement || !earned.member)) {
      findings.push({
        severity: 'error',
        message:
          `member_achievements#${earned.id} does not resolve to both an achievement and a ` +
          'member inside this tenant.',
      });
    }

    const points = await prisma.member_points.findFirst({ include: { user: true } });
    if (points && !points.user) {
      findings.push({
        severity: 'error',
        message: `member_points#${points.id} does not resolve to a member inside this tenant.`,
      });
    }

    const rating = await prisma.location_ratings.findFirst({
      include: { event: true, location: true, member: true },
    });
    if (rating && (!rating.event || !rating.location || !rating.member)) {
      findings.push({
        severity: 'error',
        message:
          `location_ratings#${rating.id} does not resolve to all three of its event, location ` +
          'and member inside this tenant.',
      });
    }
  });

  // The community must have somebody who can run it. CLAUDE.md: creating a
  // tenant creates its first admin, "without which a community is a dead end" —
  // registration is invite-gated, so nobody can let themselves in. The import
  // satisfies that by bringing v1's admins rather than by seeding one, which
  // means it is worth checking that it actually did.
  const admins = await runWithTenant(tenantId, async () =>
    // Awaited *inside* the callback. A Prisma promise is lazy: returning it
    // unawaited builds the query in context and runs it outside, where there is
    // no tenant -- so it reads whatever the ambient fallback is rather than this
    // community, and reports an empty one as having no admin.
    prisma.users.findMany({ select: { id: true, email: true, role: true, isServiceAccount: true } }),
  );
  const realAdmins = admins.filter((u) => !u.isServiceAccount && hasAdminRights(u.role));
  if (realAdmins.length === 0) {
    findings.push({
      severity: 'error',
      message:
        'No admin was imported. Registration is invite-gated and invites require a member, so ' +
        'this community is a dead end: nobody can sign in to it and nobody can be let in.',
    });
  }

  // A tenant that is not root and holds no city, with city-bearing data, would
  // render every chooser empty.
  const cities = counts.get('cities') ?? 0;
  if (cities === 0) {
    findings.push({
      severity: 'error',
      message: 'No city was imported, but feature_cities is on and every row carries one.',
    });
  }

  // Exactly one default city, which is what `resolveDefaultCityId` relies on.
  const defaults = await runWithTenant(tenantId, async () =>
    prisma.cities.count({ where: { isDefault: true } }),
  );
  if (defaults !== 1) {
    findings.push({
      severity: 'error',
      message:
        `${defaults} city/cities are marked default; exactly one must be. resolveDefaultCityId ` +
        'falls back to the lowest id, so this is recoverable, but it was not intended.',
    });
  }

  // `calendar_token` is the one column whose loss is both silent and
  // member-visible: 26 of 62 live iCal subscriptions depend on it still
  // identifying the same person. Compared against the source rather than merely
  // counted as non-null, by the caller that holds the source connection.
  const withToken = await runWithTenant(tenantId, async () =>
    prisma.users.count({ where: { calendarToken: { not: null } } }),
  );
  findings.push({
    severity: 'warning',
    message:
      `${withToken} imported member(s) carry a calendar_token. Compare this against the source ` +
      "(SELECT COUNT(*) FROM users WHERE calendar_token IS NOT NULL) — they must match, or " +
      'somebody’s calendar feed has gone quiet with no error shown to anyone.',
  });

  // Nothing should have landed in the root tenant or any other community. This
  // is the same question as 3 from the other side, and it is cheap.
  const stray = await runUnscoped(
    'checking the import wrote nothing outside its tenant',
    async () =>
      prisma.users.count({ where: { tenantId: { not: tenantId }, calendarToken: { not: null } } }),
  );
  if (stray > 0) {
    findings.push({
      severity: 'warning',
      message:
        `${stray} user(s) outside this tenant hold a calendar_token. Expected if the deployment ` +
        'already had communities; a surprise if it did not.',
    });
  }

  return { findings, ok: !findings.some((f) => f.severity === 'error') };
}

/** The findings as lines for the console, errors first. */
export function formatValidation(result: ValidationResult): string {
  const errors = result.findings.filter((f) => f.severity === 'error');
  const warnings = result.findings.filter((f) => f.severity === 'warning');
  if (result.findings.length === 0) return 'Validation: every check passed.';
  return [
    `Validation: ${errors.length} error(s), ${warnings.length} warning(s).`,
    ...errors.map((f) => `  ERROR   ${f.message}`),
    ...warnings.map((f) => `  note    ${f.message}`),
  ].join('\n');
}
