/**
 * One-shot: move release credits from `feedback` onto `system_reports` (v2-43).
 *
 * v1 credited community feedback on a release. v2-32 made bugs and requests a
 * **shared, product-level board** (`system_reports`) and left feedback as the
 * community's own; v2-43 then removed feedback linking from the composer,
 * because a deployment-wide note crediting a tenant-scoped ticket made credit
 * depend on which host the operator happened to be composing from.
 *
 * This moves the handful of existing links across so nothing loses its credit.
 *
 * ## It is a MOVE, not a copy
 * Each `release_feedback` row becomes a `system_reports` row pointing at the
 * same release, and the join row is then deleted. Copying would credit the
 * same contribution twice on the same note -- once through each path.
 *
 * The `feedback` row itself is untouched: it stays on its community's board,
 * where its author posted it.
 *
 * ## Private feedback is skipped
 * `system_reports` is readable by every community's admins. A ticket its
 * author marked private was written for their own community, and moving it
 * would change the audience after the fact -- the thing v2-32 explicitly
 * refused to do. Those are listed and left alone.
 *
 * ## Run it twice safely
 * A row whose report already exists (same reporter, same release, same title)
 * is skipped, so a re-run after a partial failure finishes the job.
 *
 * Usage:
 *   npm run credits:migrate            # dry run -- prints what it would do
 *   npm run credits:migrate -- --confirm
 */
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';

type Row = {
  releaseId: number;
  version: string;
  feedbackId: number;
  title: string | null;
  body: string;
  category: string;
  isPrivate: boolean;
  userId: number | null;
  tenantId: number;
  authorName: string | null;
  resolvedAt: Date | null;
};

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm');
  // A bare client: this walks every tenant deliberately, and the scoping
  // extension would refuse a read with no tenant in context.
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

  // Raw, deliberately: this walks every tenant's feedback, and the point of the
  // script is to see all of it before deciding. `feedback` is tenant-scoped, so
  // a client-side read would need a waiver per tenant and could not join.
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT rf.release_id   AS releaseId,
           r.version       AS version,
           f.id            AS feedbackId,
           f.title         AS title,
           f.body          AS body,
           f.category      AS category,
           f.is_private    AS isPrivate,
           f.user_id       AS userId,
           f.tenant_id     AS tenantId,
           u.full_name     AS authorName,
           f.resolved_at   AS resolvedAt
      FROM release_feedback rf
      JOIN releases r ON rf.release_id = r.id
      JOIN feedback  f ON rf.feedback_id = f.id
      LEFT JOIN users u ON f.user_id = u.id
     ORDER BY r.version, f.id`;

  if (rows.length === 0) {
    console.log('Nothing to migrate: no release_feedback rows.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${rows.length} credited feedback row(s):\n`);
  let moved = 0;
  let skippedPrivate = 0;
  let skippedExisting = 0;

  for (const row of rows) {
    const isPrivate = Boolean(row.isPrivate);
    const label = `v${row.version}  "${row.title ?? '(no title)'}"  by ${row.authorName ?? 'unknown'} (tenant ${row.tenantId})`;

    if (isPrivate) {
      console.log(`  SKIP (private)  ${label}`);
      skippedPrivate += 1;
      continue;
    }

    const existing = await prisma.system_reports.findFirst({
      where: {
        shippedInReleaseId: row.releaseId,
        reportedByUserId: row.userId,
        title: row.title ?? '(untitled)',
      },
      select: { id: true },
    });
    if (existing) {
      console.log(`  SKIP (already migrated, report ${existing.id})  ${label}`);
      skippedExisting += 1;
      continue;
    }

    if (!confirm) {
      console.log(`  MOVE            ${label}`);
      moved += 1;
      continue;
    }

    await prisma.$transaction(async (tx) => {
      const report = await tx.system_reports.create({
        data: {
          category: row.category === 'feature_request' ? 'feature_request' : 'bug',
          title: row.title ?? '(untitled)',
          body: row.body,
          status: 'shipped',
          reportedByUserId: row.userId,
          reportedByTenantId: row.tenantId,
          shippedInReleaseId: row.releaseId,
          resolvedAt: row.resolvedAt ?? new Date(),
        },
      });
      // The move: without this the same contribution is credited twice on the
      // same note, once down each path.
      await tx.release_feedback.deleteMany({
        where: { releaseId: row.releaseId, feedbackId: row.feedbackId },
      });
      console.log(`  MOVED -> report ${report.id}  ${label}`);
    });
    moved += 1;
  }

  console.log(
    `\n${confirm ? 'Moved' : 'Would move'} ${moved}; skipped ${skippedPrivate} private, ${skippedExisting} already migrated.`,
  );
  if (!confirm) console.log('Dry run. Re-run with --confirm to write.');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
