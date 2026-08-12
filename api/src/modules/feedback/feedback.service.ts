import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, feedback as Feedback, feedback_notes as FeedbackNote } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { FeedbackCategory, FeedbackStatus } from '../../database/enums';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { CreateNoteDto } from './dto/create-note.dto';
// Default import, not `import * as`: sanitize-html is a CommonJS module whose
// export IS the function. A namespace object is not callable under ESM, so
// `import * as` only worked because tsc emitted CommonJS — it throws
// "is not a function" the moment the file is loaded as a real ES module,
// which is how Vitest loads it.
import sanitizeHtml from 'sanitize-html';
import { toPublicUser } from '../../common/utils/public-user.util';

// feedback <-> releases is a many-to-many that TypeORM hid behind
// @ManyToMany, exposing `releases: ReleaseEntity[]`. Prisma models the
// release_feedback join table explicitly, so the join rows are flattened back
// to a `releases` array and dropped, leaving the response shape unchanged.
const WITH_RELEASES = {
  user: true,
  release_feedback: { include: { releases: true } },
} satisfies Prisma.feedbackInclude;

type FeedbackWithReleases = Prisma.feedbackGetPayload<{ include: typeof WITH_RELEASES }>;

function withReleases(fb: FeedbackWithReleases) {
  const { release_feedback, ...rest } = fb;
  return {
    ...rest,
    user: toPublicUser(fb.user),
    releases: release_feedback.map((rf) => rf.releases),
  };
}

const ALLOWED_HTML = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['s', 'u']),
  allowedAttributes: { a: ['href', 'target', 'rel'], ...sanitizeHtml.defaults.allowedAttributes },
};

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  // ── Member: Create ────────────────────────────────────────────────────────

  async create(dto: CreateFeedbackDto, userId: number): Promise<Feedback> {
    return this.prisma.feedback.create({
      data: {
        userId,
        title: dto.title,
        category: dto.category,
        body: sanitizeHtml(dto.body, ALLOWED_HTML),
        isPrivate: dto.isPrivate ?? false,
      },
    });
  }

  // ── Member: List ──────────────────────────────────────────────────────────

  async findPublic(
    currentUserId: number,
    category?: FeedbackCategory,
    sort: 'newest' | 'upvotes' = 'newest',
  ): Promise<(Feedback & { hasUpvoted: boolean })[]> {
    // The privacy clause is the load-bearing part: a private ticket is only
    // visible to its own author, so the OR must stay grouped rather than
    // becoming a sibling condition.
    const items = await this.prisma.feedback.findMany({
      where: {
        OR: [{ isPrivate: false }, { userId: currentUserId }],
        ...(category ? { category } : {}),
      },
      include: { user: true },
      orderBy:
        sort === 'upvotes'
          ? [{ upvoteCount: 'desc' }, { createdAt: 'desc' }]
          : [{ createdAt: 'desc' }],
    });

    const upvoted = await this.prisma.feedback_upvotes.findMany({
      where: { memberId: currentUserId },
    });
    const upvotedSet = new Set(upvoted.map((u) => u.feedbackId));

    return items.map((fb) =>
      Object.assign(fb, { user: toPublicUser(fb.user), hasUpvoted: upvotedSet.has(fb.id) }),
    );
  }

  async findMine(userId: number): Promise<Feedback[]> {
    return this.prisma.feedback.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Member: Detail ────────────────────────────────────────────────────────

  async findOne(id: number, currentUserId?: number, isAdmin = false): Promise<Feedback> {
    const item = await this.prisma.feedback.findUnique({
      where: { id },
      include: { user: true },
    });
    if (!item) throw new NotFoundException(`Feedback ${id} not found`);
    if (item.isPrivate && !isAdmin && item.userId !== currentUserId) {
      throw new ForbiddenException('This ticket is private');
    }
    return Object.assign(item, { user: toPublicUser(item.user) });
  }

  // ── Member: Upvote toggle ─────────────────────────────────────────────────

  async toggleUpvote(feedbackId: number, userId: number): Promise<{ upvoteCount: number; hasUpvoted: boolean }> {
    const item = await this.prisma.feedback.findUnique({ where: { id: feedbackId } });
    if (!item) throw new NotFoundException(`Feedback ${feedbackId} not found`);
    if (item.isPrivate && item.userId !== userId) throw new ForbiddenException('This ticket is private');

    const existing = await this.prisma.feedback_upvotes.findFirst({
      where: { feedbackId, memberId: userId },
    });

    // The upvote row and the denormalised counter are written together, so a
    // failure between them cannot leave the count disagreeing with the rows.
    // update() returns the new row, which also removes the re-read each branch
    // needed to report the resulting count.
    if (existing) {
      const [, updated] = await this.prisma.$transaction([
        this.prisma.feedback_upvotes.deleteMany({ where: { feedbackId, memberId: userId } }),
        this.prisma.feedback.update({
          where: { id: feedbackId },
          data: { upvoteCount: { decrement: 1 } },
        }),
      ]);
      return { upvoteCount: updated.upvoteCount, hasUpvoted: false };
    } else {
      const [, updated] = await this.prisma.$transaction([
        this.prisma.feedback_upvotes.create({ data: { feedbackId, memberId: userId } }),
        this.prisma.feedback.update({
          where: { id: feedbackId },
          data: { upvoteCount: { increment: 1 } },
        }),
      ]);
      return { upvoteCount: updated.upvoteCount, hasUpvoted: true };
    }
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  async getNotes(feedbackId: number, currentUserId: number, isAdmin: boolean): Promise<FeedbackNote[]> {
    const feedback = await this.prisma.feedback.findUnique({ where: { id: feedbackId } });
    if (!feedback) throw new NotFoundException(`Feedback ${feedbackId} not found`);
    if (feedback.isPrivate && !isAdmin && feedback.userId !== currentUserId) {
      throw new ForbiddenException('This ticket is private');
    }

    const notes = await this.prisma.feedback_notes.findMany({
      where: {
        feedbackId,
        // Non-admins never see admin-only notes.
        ...(isAdmin ? {} : { isAdminOnly: false }),
      },
      include: { author: true },
      orderBy: { createdAt: 'asc' },
    });
    return notes.map((n) => Object.assign(n, { author: toPublicUser(n.author) }));
  }

  async addNote(
    feedbackId: number,
    authorId: number,
    dto: CreateNoteDto,
    isAdmin: boolean,
  ): Promise<FeedbackNote> {
    const feedback = await this.prisma.feedback.findUnique({ where: { id: feedbackId } });
    if (!feedback) throw new NotFoundException(`Feedback ${feedbackId} not found`);
    if (!isAdmin && dto.isAdminOnly) throw new ForbiddenException('Only admins can post admin-only notes');

    // create returns the row with author included, so the separate re-read
    // the entity version needed is gone.
    const saved = await this.prisma.feedback_notes.create({
      data: {
        feedbackId,
        authorId,
        content: sanitizeHtml(dto.content, ALLOWED_HTML),
        isAdminOnly: isAdmin ? (dto.isAdminOnly ?? false) : false,
      },
      include: { author: true },
    });
    return Object.assign(saved, { author: toPublicUser(saved.author) });
  }

  // ── Admin: List / update ──────────────────────────────────────────────────

  async findAll(): Promise<Feedback[]> {
    const items = await this.prisma.feedback.findMany({
      include: WITH_RELEASES,
      orderBy: { createdAt: 'desc' },
    });
    return items.map(withReleases);
  }

  async getOpenBugs(): Promise<Feedback[]> {
    const items = await this.prisma.feedback.findMany({
      where: { category: FeedbackCategory.BUG, status: FeedbackStatus.OPEN },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return items.map((fb) => Object.assign(fb, { user: toPublicUser(fb.user) }));
  }

  async getInProgress(): Promise<Feedback[]> {
    const items = await this.prisma.feedback.findMany({
      where: { status: FeedbackStatus.IN_PROGRESS },
      include: WITH_RELEASES,
      orderBy: { updatedAt: 'asc' },
    });
    return items.map(withReleases);
  }

  async update(id: number, dto: UpdateFeedbackDto): Promise<Feedback> {
    const item = await this.prisma.feedback.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Feedback ${id} not found`);

    const data: Prisma.feedbackUpdateInput = {};
    if (dto.status !== undefined) {
      data.status = dto.status;
      const terminalStatuses: FeedbackStatus[] = [FeedbackStatus.RESOLVED, FeedbackStatus.SHIPPED];
      if (terminalStatuses.includes(dto.status) && !item.resolvedAt) {
        data.resolvedAt = new Date();
      } else if (!terminalStatuses.includes(dto.status)) {
        data.resolvedAt = null;
      }
    }
    if (dto.adminNote !== undefined) data.adminNote = dto.adminNote ?? null;
    if (dto.releaseNote !== undefined) data.releaseNote = dto.releaseNote ?? null;
    return this.prisma.feedback.update({ where: { id }, data });
  }

  // ── Admin: Seen tracking ──────────────────────────────────────────────────

  async getUnseenCount(): Promise<number> {
    return this.prisma.feedback.count({ where: { seenAt: null } });
  }

  async markSeen(id: number): Promise<Feedback> {
    const item = await this.prisma.feedback.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Feedback ${id} not found`);
    if (!item.seenAt) {
      return this.prisma.feedback.update({ where: { id }, data: { seenAt: new Date() } });
    }
    return item;
  }

  async markAllSeen(): Promise<void> {
    await this.prisma.feedback.updateMany({
      where: { seenAt: null },
      data: { seenAt: new Date() },
    });
  }

  // ── Member: Profile stats ─────────────────────────────────────────────────

  async getMemberStats(userId: number): Promise<{
    bugsReported: number;
    featuresRequested: number;
    shippedCount: number;
  }> {
    const [bugsReported, featuresRequested, shippedCount] = await Promise.all([
      this.prisma.feedback.count({ where: { userId, category: FeedbackCategory.BUG } }),
      this.prisma.feedback.count({
        where: { userId, category: FeedbackCategory.FEATURE_REQUEST },
      }),
      this.prisma.feedback.count({ where: { userId, status: FeedbackStatus.SHIPPED } }),
    ]);
    return { bugsReported, featuresRequested, shippedCount };
  }
}
