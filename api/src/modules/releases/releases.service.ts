import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  feedback as Feedback,
  releases as Release,
  release_feedback as ReleaseFeedback,
  users as User,
} from '@prisma/client';
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
  release_feedback?: (ReleaseFeedback & { feedback: Feedback & { user?: User | null } })[];
};

const RELEASE_INCLUDE = {
  author: true,
  release_feedback: { include: { feedback: { include: { user: true } } } },
} satisfies Prisma.releasesInclude;

function toPublicAuthor(user: User | null | undefined): PublicAuthor | null {
  if (!user) return null;
  return { id: user.id, fullName: user.fullName, profilePhotoPath: user.profilePhotoPath };
}

function toPublicRelease(release: ReleaseWithRelations) {
  const { release_feedback, ...rest } = release;
  return {
    ...rest,
    author: toPublicAuthor(release.author),
    linkedFeedback: (release_feedback ?? []).map((rf) => ({
      ...rf.feedback,
      user: toPublicAuthor(rf.feedback.user),
    })),
  };
}

@Injectable()
export class ReleasesService {
  constructor(private readonly prisma: PrismaService) {}

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
    return releases.map(toPublicRelease);
  }

  async findOnePublished(id: number): Promise<ReturnType<typeof toPublicRelease>> {
    const release = await this.prisma.releases.findFirst({
      where: { id, publishedAt: { not: null } },
      include: RELEASE_INCLUDE,
    });
    if (!release) throw new NotFoundException(`Release ${id} not found`);
    return toPublicRelease(release);
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  async findAll(): Promise<ReturnType<typeof toPublicRelease>[]> {
    const releases = await this.prisma.releases.findMany({
      include: RELEASE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return releases.map(toPublicRelease);
  }

  async findOneAdmin(id: number): Promise<ReturnType<typeof toPublicRelease>> {
    const release = await this.prisma.releases.findUnique({
      where: { id },
      include: RELEASE_INCLUDE,
    });
    if (!release) throw new NotFoundException(`Release ${id} not found`);
    return toPublicRelease(release);
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
      await this.prisma.$executeRaw`
        UPDATE feedback
        SET status = ${FeedbackStatus.SHIPPED},
            resolved_at = COALESCE(resolved_at, NOW())
        WHERE id IN (${Prisma.join(ids)})`;
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
