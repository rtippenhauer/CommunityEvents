import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { runUnscoped } from '../../common/tenant/tenant-store';
import { FeedbackStatus, UserRole } from '../../database/enums';
import type { users as User } from '@prisma/client';
import { CreateSystemBugDto } from './dto/create-system-bug.dto';
import { UpdateSystemBugDto } from './dto/update-system-bug.dto';
import { CreateDemoFeedbackDto } from './dto/create-demo-feedback.dto';

/**
 * How a reporter is described to whoever is reading (Rob, 2026-10-04).
 *
 * Three audiences, three answers, and the middle one is the whole design: a bug
 * board shared across communities must carry the *report* everywhere and the
 * *person* only where they are already known.
 *
 *  - their own community's admins -- the full name, as on any other board
 *  - any other community's admins -- "a member of another community", with no
 *    name and **no community name either**. Naming the community would disclose
 *    the deployment's customer list to anybody who obtains a tenant, which is a
 *    different and larger leak than the one being avoided. The word is
 *    deliberately "member" and not the more accurate "admin" (Rob,
 *    2026-10-04): the role is information about that community's structure, and
 *    where it has one or two admins it narrows the set far enough that timing
 *    could name the person.
 *  - the system admin on the root tenant -- name and community both, because
 *    replying to a defect report means knowing who hit it and where.
 */
export type ReporterView =
  | { kind: 'self'; fullName: string }
  | { kind: 'other' }
  | { kind: 'operator'; fullName: string; community: string }
  | { kind: 'departed' };

export type SystemReportCategory = 'bug' | 'feature_request';

export interface SystemBugView {
  id: number;
  category: SystemReportCategory;
  /** The release this shipped in, or null while it is still open. */
  shippedInVersion: string | null;
  title: string;
  screenshots: string[];
  body: string;
  status: FeedbackStatus;
  adminNote: string | null;
  reporter: ReporterView;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
}

export interface DemoFeedbackView {
  id: number;
  /** The requester's address; null on rows written before 2026-10-09. */
  submittedByEmail: string | null;
  body: string | null;
  rating: number | null;
  wouldUse: string | null;
  whatWorked: string | null;
  whatDidnt: string | null;
  demoLabel: string;
  createdAt: Date;
}

/** Who is asking, resolved once per request rather than per row. */
interface Viewer {
  tenantId: number;
  isRootTenant: boolean;
  role: string;
  /** `users.is_service_account` — the automation account's stable identity. */
  isServiceAccount: boolean;
}

/**
 * Reads the stored screenshot JSON back, defensively.
 *
 * The column is text, so a malformed value is something the reader has to
 * survive rather than something the writer can rule out -- a hand-edited row or
 * a half-applied migration should cost a missing thumbnail, not a 500 on the
 * board every community reads. The path *shape* was validated on the way in by
 * `CreateSystemBugDto`, which is where that check belongs.
 */
function parseScreenshots(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

@Injectable()
export class SystemReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Whoever is operating the deployment rather than a community.
   *
   * **The automation account counts, and is recognised by
   * `is_service_account` rather than by its role** (Rob, 2026-10-04).
   *
   * This keyed on the role twice before it was right. First `system_admin`
   * alone, so automation saw every reporter as "a member of another community";
   * then `system_admin || automation`, which still failed on stage -- because
   * the service account is deliberately **flipped between roles** for testing
   * and was sitting at `admin` when it was tried.
   *
   * CLAUDE.md says this in two places, about this exact account: guards key on
   * the column, *never* on the role, because the role is the one property here
   * guaranteed to change. `automationLogin` already does it correctly. This did
   * not, and the symptom was a projection that silently withheld every name at
   * the moment the account was being used.
   *
   * Both halves of the pair still apply: the **root tenant** and either the
   * `system_admin` role or the service account. A community's own admin
   * satisfies neither, and `automationLogin` admits no tenant but root.
   */
  private isOperator(viewer: Viewer): boolean {
    return viewer.isRootTenant && (viewer.role === UserRole.SYSTEM_ADMIN || viewer.isServiceAccount);
  }

  // ── System bugs ───────────────────────────────────────────────────────────

  /**
   * Files a bug against the deployment.
   *
   * The row is global, so this is written under a waiver -- but the *provenance*
   * is recorded explicitly from the caller rather than inferred, because a
   * global write has no ambient tenant to fall back on and a bug attributed to
   * nobody cannot be credited or replied to.
   */
  async fileBug(user: User, tenantId: number, dto: CreateSystemBugDto): Promise<{ id: number }> {
    const created = await runUnscoped('a bug report is deployment-wide by design', async () =>
      await this.prisma.system_reports.create({
        data: {
          category: dto.category,
          title: dto.title,
          body: dto.body,
          // Stored as JSON text. Null rather than "[]" when there are none, so
          // the common case costs nothing and reads as absent rather than empty.
          screenshots: dto.screenshots?.length ? JSON.stringify(dto.screenshots) : null,
          reportedByUserId: user.id,
          reportedByTenantId: tenantId,
        },
        select: { id: true },
      }),
    );
    return created;
  }

  /**
   * The shared board.
   *
   * Read unscoped on purpose and narrowed immediately: the rows are global, and
   * the only cross-tenant data on them is the reporter, which `describeReporter`
   * strips before anything leaves this service. Nothing here traverses into
   * `users` through a relation `include` -- that is the global-parent-to-scoped-
   * child hop the extension documents it cannot filter, and the one that leaked
   * every community's feedback through `RELEASE_INCLUDE` until 2026-10-02.
   */
  async listBugs(viewer: Viewer): Promise<SystemBugView[]> {
    const rows = await runUnscoped('the bug board spans every community', async () =>
      await this.prisma.system_reports.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          category: true,
          title: true,
          body: true,
          status: true,
          adminNote: true,
          screenshots: true,
          shippedInRelease: { select: { version: true } },
          reportedByUserId: true,
          reportedByTenantId: true,
          createdAt: true,
          updatedAt: true,
          resolvedAt: true,
        },
      }),
    );

    const reporters = await this.describeReporters(rows, viewer);

    return rows.map((row) => ({
      id: row.id,
      category: row.category as SystemReportCategory,
      shippedInVersion: row.shippedInRelease?.version ?? null,
      title: row.title,
      screenshots: parseScreenshots(row.screenshots),
      body: row.body,
      status: row.status as FeedbackStatus,
      // An operator's working note is not part of the shared record. It is
      // where "this is actually a duplicate of X" and "the customer's DNS is
      // wrong" get written, neither of which belongs on every community's board.
      adminNote: this.isOperator(viewer) ? row.adminNote : null,
      reporter: reporters.get(row.id) ?? { kind: 'departed' },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      resolvedAt: row.resolvedAt,
    }));
  }

  /**
   * Resolves every reporter in one pass, with the lookups the viewer is
   * entitled to and no others.
   *
   * The ordinary admin's case does **no** cross-tenant read at all: their own
   * community's reporters are fetched through the scoped client, so the
   * extension proves the isolation rather than this method promising it. Only
   * the operator takes the waiver, and only because answering them is this
   * table's purpose.
   */
  private async describeReporters(
    rows: { id: number; reportedByUserId: number | null; reportedByTenantId: number | null }[],
    viewer: Viewer,
  ): Promise<Map<number, ReporterView>> {
    const views = new Map<number, ReporterView>();
    const userIds = [
      ...new Set(rows.map((r) => r.reportedByUserId).filter((id): id is number => id !== null)),
    ];

    if (this.isOperator(viewer)) {
      if (userIds.length === 0) return views;
      const users = await runUnscoped('the operator is answering reports from every community', async () =>
        await this.prisma.users.findMany({
          where: { id: { in: userIds } },
          select: { id: true, fullName: true, tenantId: true },
        }),
      );
      const tenantIds = [...new Set(users.map((u) => u.tenantId))];
      const tenants = await runUnscoped('naming the community a report came from', async () =>
        await this.prisma.tenants.findMany({
          where: { id: { in: tenantIds } },
          select: { id: true, slug: true },
        }),
      );
      const tenantName = new Map(tenants.map((t) => [t.id, t.slug]));
      const byUser = new Map(users.map((u) => [u.id, u]));

      for (const row of rows) {
        const user = row.reportedByUserId ? byUser.get(row.reportedByUserId) : undefined;
        views.set(
          row.id,
          user
            ? {
                kind: 'operator',
                fullName: user.fullName,
                community: tenantName.get(user.tenantId) ?? 'unknown',
              }
            : { kind: 'departed' },
        );
      }
      return views;
    }

    // Everyone else. The scoped lookup returns this community's reporters and
    // silently omits the rest, exactly as `linkedFeedbackFor` does for release
    // credits -- so a name cannot escape even if the branch below were wrong.
    const mine =
      userIds.length === 0
        ? []
        : await this.prisma.users.findMany({
            where: { id: { in: userIds } },
            select: { id: true, fullName: true },
          });
    const byUser = new Map(mine.map((u) => [u.id, u.fullName]));

    for (const row of rows) {
      const name = row.reportedByUserId ? byUser.get(row.reportedByUserId) : undefined;
      if (name && row.reportedByTenantId === viewer.tenantId) {
        views.set(row.id, { kind: 'self', fullName: name });
      } else if (row.reportedByUserId === null && row.reportedByTenantId === null) {
        views.set(row.id, { kind: 'departed' });
      } else {
        views.set(row.id, { kind: 'other' });
      }
    }
    return views;
  }

  /**
   * Status and working notes, operator only.
   *
   * `resolvedAt` is derived from the status rather than accepted from the
   * caller: two fields that can disagree about whether something is resolved is
   * one field too many.
   */
  async updateBug(id: number, dto: UpdateSystemBugDto): Promise<SystemBugView> {
    const existing = await runUnscoped('the operator acts on every community\'s reports', async () =>
      await this.prisma.system_reports.findUnique({ where: { id }, select: { id: true, status: true } }),
    );
    if (!existing) throw new NotFoundException('Report not found');

    const nextStatus = dto.status ?? (existing.status as FeedbackStatus);
    const isDone =
      nextStatus === FeedbackStatus.RESOLVED ||
      nextStatus === FeedbackStatus.SHIPPED ||
      nextStatus === FeedbackStatus.CLOSED ||
      nextStatus === FeedbackStatus.WONT_FIX;

    /**
     * The release is named by version and resolved here.
     *
     * An unknown version is refused rather than ignored: silently leaving the
     * link null would mark the report shipped with nothing to credit, and the
     * contributor's thanks would disappear with no error anywhere. An empty
     * string clears it, for a release that gets unpublished.
     *
     * By version and not by row id, because automation knows "2.0.0" and does
     * not know what primary key that release took on this deployment -- stage
     * and production differ. `releases.version` is unique, which is also why
     * the note importer keys on it.
     */
    let releaseLink: Record<string, number | null> = {};
    if (dto.shippedInVersion !== undefined) {
      if (dto.shippedInVersion === '') {
        releaseLink = { shippedInReleaseId: null };
      } else {
        const version = dto.shippedInVersion;
        const release = await runUnscoped('releases are deployment-wide', async () =>
          await this.prisma.releases.findUnique({
            where: { version },
            select: { id: true },
          }),
        );
        if (!release) throw new NotFoundException(`No release with version "${version}"`);
        releaseLink = { shippedInReleaseId: release.id };
      }
    }

    await runUnscoped('the operator acts on every community\'s reports', async () =>
      await this.prisma.system_reports.update({
        where: { id },
        data: {
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.adminNote !== undefined ? { adminNote: dto.adminNote } : {}),
          ...releaseLink,
          updatedAt: new Date(),
          resolvedAt: isDone ? new Date() : null,
        },
      }),
    );

    const [view] = await this.listBugs({
      tenantId: 0,
      isRootTenant: true,
      role: UserRole.SYSTEM_ADMIN,
      isServiceAccount: false,
    }).then((all) => all.filter((b) => b.id === id));
    return view;
  }

  // ── Demo feedback ─────────────────────────────────────────────────────────

  /**
   * What a demo visitor thought.
   *
   * `demoLabel` is passed in and stored rather than joined to later: the demo is
   * deleted within a week, taking its `tenants` row with it and nulling
   * `submittedByTenantId`, so a join would leave every surviving row attributed
   * to nothing. This is the one column that still says which demo it was.
   */
  async submitDemoFeedback(
    user: User,
    tenantId: number,
    demoLabel: string,
    dto: CreateDemoFeedbackDto,
  ): Promise<{ id: number }> {
    // Every field is optional on its own and at least one is required
    // together, which is a rule only this layer can see -- the DTO cannot
    // express "unless one of the others", and a database CHECK naming the
    // columns would need rewriting whenever a question is added. An empty
    // submission is a mis-click, not an answer.
    const answered =
      dto.rating !== undefined ||
      dto.wouldUse !== undefined ||
      Boolean(dto.whatWorked?.trim()) ||
      Boolean(dto.whatDidnt?.trim()) ||
      Boolean(dto.body?.trim());
    if (!answered) {
      throw new BadRequestException('Answer at least one question before sending.');
    }

    return await runUnscoped('demo feedback outlives the demo that produced it', async () =>
      await this.prisma.demo_feedback.create({
        data: {
          body: dto.body?.trim() || null,
          rating: dto.rating ?? null,
          wouldUse: dto.wouldUse ?? null,
          whatWorked: dto.whatWorked?.trim() || null,
          whatDidnt: dto.whatDidnt?.trim() || null,
          demoLabel,
          // Denormalised deliberately: the user row goes with the demo.
          submittedByEmail: user.email,
          submittedByUserId: user.id,
          submittedByTenantId: tenantId,
        },
        select: { id: true },
      }),
    );
  }

  /**
   * Read by the demo's own admin -- who is the visitor who wrote it -- and by
   * the operator, who sees every demo's.
   *
   * Unlike the bug board this is never shared sideways, so there is no reporter
   * projection: within a demo the only possible author is that demo's own
   * admin, and the operator reads the label rather than the person.
   */
  async listDemoFeedback(viewer: Viewer): Promise<DemoFeedbackView[]> {
    if (!this.isOperator(viewer) && viewer.tenantId === 0) {
      throw new ForbiddenException('Not available here.');
    }

    const where = this.isOperator(viewer) ? {} : { submittedByTenantId: viewer.tenantId };

    return await runUnscoped('demo feedback is global so it survives the demo', async () =>
      await this.prisma.demo_feedback.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          body: true,
          rating: true,
          wouldUse: true,
          whatWorked: true,
          whatDidnt: true,
          demoLabel: true,
          submittedByEmail: true,
          createdAt: true,
        },
      }),
    );
  }
}
