import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  feedback as Feedback,
  releases as Release,
  release_feedback as ReleaseFeedback,
  users as User,
} from '@prisma/client';
import { requireTenantId, runUnscoped } from '../../common/tenant/tenant-store';
import { PrismaService } from '../../database/prisma/prisma.service';
import { FeedbackStatus } from '../../database/enums';
import { CreateReleaseDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
// Default import, not `import * as`: sanitize-html is a CommonJS module whose
// export IS the function. A namespace object is not callable under ESM, so
// `import * as` only worked because tsc emitted CommonJS — it throws
// "is not a function" the moment the file is loaded as a real ES module,
// which is how Vitest loads it.
import sanitizeHtml from 'sanitize-html';

export const ALLOWED_HTML = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['s', 'u']),
  allowedAttributes: { a: ['href', 'target', 'rel'], ...sanitizeHtml.defaults.allowedAttributes },
};

export interface PublicAuthor {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
}

/**
 * TypeORM hid the release_feedback join table behind a @ManyToMany, so a
 * release carried `linkedFeedback: FeedbackEntity[]` directly. Prisma models
 * the join table explicitly, so the same query comes back as
 * `release_feedback: [{ feedback: {...} }]`.
 *
 * toPublicRelease flattens that back to `linkedFeedback` and drops the join
 * rows, so the JSON these endpoints return is unchanged. Without the flatten,
 * every release response would gain a `release_feedback` key and lose
 * `linkedFeedback`.
 */
type ReleaseWithRelations = Release & {
  author?: User | null;
  /** The join rows only — global, two ids, no hop into scoped data. */
  release_feedback?: ReleaseFeedback[];
};

/**
 * **Does not traverse into `feedback`, and that is the point.**
 *
 * `releases` and `release_feedback` are global; `feedback` is tenant-scoped.
 * The scoping extension cannot filter a to-one hop from a global parent --
 * Prisma accepts no `where` on a to-one include -- and `tenant-scope.extension`
 * names this exact chain as the one such case in the schema. So this used to be
 * `release_feedback: { include: { feedback: { include: { user: true } } } }`,
 * and `toPublicRelease` spread the whole feedback row into the response.
 *
 * The result: any signed-in member of any community reading the deployment-wide
 * release notes received **other communities' feedback in full** -- `body`,
 * `adminNote`, `status`, `title` -- including tickets their author had marked
 * private. Demo visitors are ordinary members of their own community, so after
 * v2-14 that audience included strangers. The frontend even redacts the
 * submitter's name when `isPrivate` is set, which shows the intent was
 * understood and enforced in the wrong layer: the API shipped the private body
 * regardless. Found by review, 2026-10-02.
 *
 * The join rows themselves are safe to read -- they are global and carry only
 * two ids. `attachLinkedFeedback` resolves those ids through the **scoped**
 * client, which is the "anchor the query on the scoped model" the extension's
 * comment asks for.
 */
const RELEASE_INCLUDE = {
  author: true,
  release_feedback: true,
} satisfies Prisma.releasesInclude;

/**
 * What a release says about the feedback behind it: enough to credit somebody
 * and to let a feedback page say "shipped in 1.6.0", and nothing else.
 *
 * Every consumer was checked before narrowing this. `updates.component` reads
 * `isPrivate` and `user.fullName` for the credit line, and the feedback board,
 * the feedback detail page and the admin release screen each match on `id`
 * alone. Nothing rendered `body`, `title`, `adminNote` or `status`, so serving
 * them was pure exposure.
 */
export interface LinkedFeedback {
  id: number;
  isPrivate: boolean;
  user: PublicAuthor | null;
}

function toPublicAuthor(user: User | null | undefined): PublicAuthor | null {
  if (!user) return null;
  return { id: user.id, fullName: user.fullName, profilePhotoPath: user.profilePhotoPath };
}

/**
 * What one release resolved to for the community asking: the tickets from
 * *this* community, and a bare count of the ones from everywhere else.
 */
interface ResolvedCredits {
  visible: LinkedFeedback[];
  anonymous: number;
}

function toPublicRelease(release: ReleaseWithRelations, credits: ResolvedCredits) {
  const { release_feedback, ...rest } = release;
  return {
    ...rest,
    author: toPublicAuthor(release.author),
    linkedFeedback: credits.visible,
    /**
     * How many of this release's linked tickets came from another community
     * (Rob, 2026-10-03). A number, never an id and never a name: the point is
     * that the work was asked for by a member somewhere, not who or where.
     *
     * Dropping those tickets silently -- which is what this did before -- made
     * a release that shipped entirely on another community's reports show no
     * credit line at all, crediting nobody for work somebody did ask for.
     */
    anonymousCredits: credits.anonymous,
  };
}

@Injectable()
export class ReleasesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves the feedback behind a set of releases, **through the scoped
   * client**.
   *
   * This is the half that makes the isolation real. `release_feedback` is global
   * and names feedback ids from every community, so these ids are read and then
   * looked up as an ordinary scoped query -- no `runUnscoped`, no traversal from
   * a global parent -- and the extension adds the tenant predicate. Ids
   * belonging to another community return no row.
   *
   * So a release shown in Dayton names Dayton's contributors and nobody else.
   * That is the correct reading of a deployment-wide note: the release is shared,
   * the people are not.
   *
   * **The ones it cannot name are counted, not discarded** (Rob, 2026-10-03).
   * Discarding them meant a release driven entirely by another community's
   * reports credited nobody, which reads as "we thought of this ourselves". The
   * count carries the fact that a member asked for it; the identity is what
   * stays behind the tenant boundary. A reporter is still named in full to their
   * own community, which is the one place the name means anything.
   *
   * One query for the whole page rather than one per release, and the shape is
   * narrowed to `LinkedFeedback` here so no caller can accidentally serve more.
   */
  private async linkedFeedbackFor(
    releases: ReleaseWithRelations[],
  ): Promise<Map<number, ResolvedCredits>> {
    const byRelease = new Map<number, ResolvedCredits>();
    for (const release of releases) byRelease.set(release.id, { visible: [], anonymous: 0 });

    const feedbackIds = [
      ...new Set(releases.flatMap((r) => (r.release_feedback ?? []).map((rf) => rf.feedbackId))),
    ];
    // Reports are credited whether or not any legacy `feedback` is linked.
    // This used to `return` here, which meant a release credited ONLY by
    // bug/feature reports -- i.e. every release from now on -- showed no
    // thanks line at all. Caught by the cross-tenant credit test.
    if (feedbackIds.length === 0) {
      await this.addReportCredits(releases, byRelease);
      return byRelease;
    }

    const rows = await this.prisma.feedback.findMany({
      where: { id: { in: feedbackIds } },
      select: { id: true, isPrivate: true, user: true },
    });
    const visible = new Map<number, LinkedFeedback>(
      rows.map((row) => [
        row.id,
        { id: row.id, isPrivate: row.isPrivate, user: toPublicAuthor(row.user) },
      ]),
    );

    for (const release of releases) {
      const links = release.release_feedback ?? [];
      const mine = links
        .map((rf) => visible.get(rf.feedbackId))
        .filter((fb): fb is LinkedFeedback => fb !== undefined);
      // Everything the scoped lookup did not return belongs to another
      // community. Counted, not resolved -- there is deliberately no second
      // query to find out whose it was.
      byRelease.set(release.id, { visible: mine, anonymous: links.length - mine.length });
    }

    await this.addReportCredits(releases, byRelease);
    return byRelease;
  }

  /**
   * Folds the **global bug/feature reports** shipped in these releases into the
   * same credits (v2-32, Rob 2026-10-04).
   *
   * ## Why the thanks cannot be written into the note
   *
   * A release note is authored in the repo and imported by
   * `release-notes-importer.service` into every deployment, keyed by version --
   * one blob of markdown, identical everywhere. A contributor named in that text
   * would therefore be fixed copy naming one community's member to every other
   * community on the platform.
   *
   * So the credit is a **link**, resolved here per reader. The note stays one
   * artifact and the thanks line comes out different in every community: the
   * contributor by name at home, "a community member" everywhere else.
   *
   * The reporter is resolved through the **scoped** client, exactly as the
   * feedback half above is, so a name cannot cross even if this method is
   * wrong about which tenant is asking.
   */
  private async addReportCredits(
    releases: ReleaseWithRelations[],
    byRelease: Map<number, ResolvedCredits>,
  ): Promise<void> {
    const releaseIds = releases.map((r) => r.id);
    if (releaseIds.length === 0) return;

    // The reports are global, so finding them is an explicit waiver. Only the
    // reporter id comes back -- never the title or body, which belong to the
    // board and not to a release note.
    const reports = await runUnscoped('reports shipped in a release span communities', async () =>
      await this.prisma.system_reports.findMany({
        where: { shippedInReleaseId: { in: releaseIds } },
        select: { id: true, shippedInReleaseId: true, reportedByUserId: true },
      }),
    );
    if (reports.length === 0) return;

    const userIds = [
      ...new Set(reports.map((r) => r.reportedByUserId).filter((id): id is number => id !== null)),
    ];
    const mine =
      userIds.length === 0
        ? []
        : await this.prisma.users.findMany({
            where: { id: { in: userIds } },
            select: { id: true, fullName: true, profilePhotoPath: true },
          });
    const byUser = new Map(mine.map((u) => [u.id, u]));

    for (const report of reports) {
      const credits = byRelease.get(report.shippedInReleaseId!);
      if (!credits) continue;

      const user = report.reportedByUserId ? byUser.get(report.reportedByUserId) : undefined;
      if (user) {
        // `isPrivate: false` -- a report filed on the shared board was never
        // private, so there is nothing to redact beyond the tenant boundary
        // the scoped lookup above already enforced.
        credits.visible.push({
          id: report.id,
          isPrivate: false,
          user: { id: user.id, fullName: user.fullName, profilePhotoPath: user.profilePhotoPath },
        });
      } else {
        credits.anonymous += 1;
      }
    }
  }

  /** Maps a page of releases to their public shape in one scoped lookup. */
  private async toPublicReleases(
    releases: ReleaseWithRelations[],
  ): Promise<ReturnType<typeof toPublicRelease>[]> {
    const linked = await this.linkedFeedbackFor(releases);
    return releases.map((release) =>
      toPublicRelease(release, linked.get(release.id) ?? { visible: [], anonymous: 0 }),
    );
  }

  // ── Public ────────────────────────────────────────────────────────────────

  async findPublished(): Promise<ReleaseWithRelations[]> {
    // `publishedAt: undefined` is preserved from the TypeORM version, where it
    // meant "no filter" rather than "is null" — so this returns every release,
    // published or not. Prisma treats undefined the same way, so behaviour is
    // unchanged. findPublishedList below is the one that actually filters.
    return this.prisma.releases.findMany({
      where: { publishedAt: undefined },
      include: RELEASE_INCLUDE,
      orderBy: { publishedAt: 'desc' },
    });
  }

  async findPublishedList(): Promise<ReturnType<typeof toPublicRelease>[]> {
    const releases = await this.prisma.releases.findMany({
      where: { publishedAt: { not: null } },
      include: RELEASE_INCLUDE,
      orderBy: { publishedAt: 'desc' },
    });
    return this.toPublicReleases(releases);
  }

  async findOnePublished(id: number): Promise<ReturnType<typeof toPublicRelease>> {
    const release = await this.prisma.releases.findFirst({
      where: { id, publishedAt: { not: null } },
      include: RELEASE_INCLUDE,
    });
    if (!release) throw new NotFoundException(`Release ${id} not found`);
    return (await this.toPublicReleases([release]))[0];
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  async findAll(): Promise<ReturnType<typeof toPublicRelease>[]> {
    const releases = await this.prisma.releases.findMany({
      include: RELEASE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return this.toPublicReleases(releases);
  }

  async findOneAdmin(id: number): Promise<ReturnType<typeof toPublicRelease>> {
    const release = await this.prisma.releases.findUnique({
      where: { id },
      include: RELEASE_INCLUDE,
    });
    if (!release) throw new NotFoundException(`Release ${id} not found`);
    return (await this.toPublicReleases([release]))[0];
  }

  async create(dto: CreateReleaseDto, authorId: number): Promise<Release> {
    const existing = await this.prisma.releases.findUnique({ where: { version: dto.version } });
    if (existing) throw new ConflictException(`Version ${dto.version} already exists`);

    return this.prisma.releases.create({
      data: {
        version: dto.version,
        title: dto.title,
        body: sanitizeHtml(dto.body, ALLOWED_HTML),
        createdBy: authorId,
        // Assigning release.linkedFeedback then saving becomes an explicit
        // write of the join rows.
        ...(dto.feedbackIds?.length
          ? {
              release_feedback: {
                create: dto.feedbackIds.map((feedbackId) => ({ feedbackId })),
              },
            }
          : {}),
      },
    });
  }

  async update(id: number, dto: UpdateReleaseDto): Promise<Release> {
    const release = await this.prisma.releases.findUnique({ where: { id } });
    if (!release) throw new NotFoundException(`Release ${id} not found`);
    if (release.publishedAt) throw new BadRequestException('Cannot edit a published release');

    if (dto.version !== undefined) {
      const conflict = await this.prisma.releases.findUnique({ where: { version: dto.version } });
      if (conflict && conflict.id !== id) {
        throw new ConflictException(`Version ${dto.version} already exists`);
      }
    }

    const data: Prisma.releasesUpdateInput = {};
    if (dto.version !== undefined) data.version = dto.version;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.body !== undefined) data.body = sanitizeHtml(dto.body, ALLOWED_HTML);

    if (dto.feedbackIds !== undefined) {
      // Replacing the collection wholesale, which is what assigning to
      // release.linkedFeedback did.
      data.release_feedback = {
        deleteMany: {},
        ...(dto.feedbackIds.length
          ? { create: dto.feedbackIds.map((feedbackId) => ({ feedbackId })) }
          : {}),
      };
    }

    return this.prisma.releases.update({ where: { id }, data });
  }

  async publish(id: number): Promise<Release> {
    const release = await this.prisma.releases.findUnique({
      where: { id },
      include: { release_feedback: true },
    });
    if (!release) throw new NotFoundException(`Release ${id} not found`);
    if (release.publishedAt) return release;

    const saved = await this.prisma.releases.update({
      where: { id },
      data: { publishedAt: new Date() },
    });

    // Mark linked resolved feedback as shipped
    const ids = release.release_feedback.map((rf) => rf.feedbackId);
    if (ids.length) {
      // Raw because resolved_at must keep any timestamp it already had —
      // COALESCE(resolved_at, NOW()) has no equivalent in updateMany, which can
      // only set a column to a fixed value. Overwriting it would rewrite the
      // resolution date of every ticket each time a release is published.
      // `releases` is a global model but `feedback` is tenant-scoped, and raw
      // SQL does not pass through the scoping extension — so this carries its
      // own predicate. Publishing a release must not flip another community's
      // tickets to shipped, even though the release itself is deployment-wide.
      await this.prisma.$executeRaw`
        UPDATE feedback
        SET status = ${FeedbackStatus.SHIPPED},
            resolved_at = COALESCE(resolved_at, NOW())
        WHERE id IN (${Prisma.join(ids)})
          AND tenant_id = ${requireTenantId('release publish')}`;
    }

    return saved;
  }

  async unpublish(id: number): Promise<Release> {
    const release = await this.prisma.releases.findUnique({
      where: { id },
      include: { release_feedback: true },
    });
    if (!release) throw new NotFoundException(`Release ${id} not found`);
    if (!release.publishedAt) return release;

    const saved = await this.prisma.releases.update({
      where: { id },
      data: { publishedAt: null },
    });

    // Undo the "shipped" marking on any linked feedback tickets so the two
    // stay consistent with the release no longer being public.
    const ids = release.release_feedback.map((rf) => rf.feedbackId);
    if (ids.length) {
      await this.prisma.feedback.updateMany({
        where: { id: { in: ids }, status: FeedbackStatus.SHIPPED },
        data: { status: FeedbackStatus.RESOLVED },
      });
    }

    return saved;
  }

  async getResolvedFeedback(): Promise<Feedback[]> {
    return this.prisma.feedback.findMany({
      where: { status: FeedbackStatus.RESOLVED },
      include: { user: true },
      orderBy: { updatedAt: 'desc' },
    });
  }
}
