import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
// Default import, not `import * as`: sanitize-html is a CommonJS module whose
// export IS the function. A namespace object is not callable under ESM, so
// `import * as` only worked because tsc emitted CommonJS — it throws
// "is not a function" the moment the file is loaded as a real ES module,
// which is how Vitest loads it.
import sanitizeHtml from 'sanitize-html';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  AnnouncementStatus,
  FlagStatus,
  UserRole,
} from '../../database/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../notifications/push.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { FlagContentDto } from './dto/flag-content.dto';
import { toPublicUser, toAnonSafeUser } from '../../common/utils/public-user.util';
import { ELEVATED_ROLES } from '../../common/utils/roles.util';

// Named once: findOne and findOneAdmin both feed sanitizeAnnouncement, which
// reads author and the comment authors off the loaded row.
const FULL_INCLUDE = {
  city: true,
  author: true,
  comments: { include: { user: true } },
} satisfies Prisma.announcementsInclude;

type AnnouncementWithRelations = Prisma.announcementsGetPayload<{
  include: typeof FULL_INCLUDE;
}>;

const ALLOWED_HTML = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['s', 'u']),
  allowedAttributes: { a: ['href', 'target', 'rel'], ...sanitizeHtml.defaults.allowedAttributes },
};

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushService,
  ) {}

  async findPublished(cityId?: number, isAuthenticated = false) {
    // The city filter keeps its OR against NULL: a null city_id means the
    // announcement is global and must appear for every city.
    const results = await this.prisma.announcements.findMany({
      where: {
        status: AnnouncementStatus.PUBLISHED,
        ...(cityId ? { OR: [{ cityId }, { cityId: null }] } : {}),
      },
      include: { city: true, author: true },
      orderBy: { publishedAt: 'desc' },
    });
    const toUser = isAuthenticated ? toPublicUser : toAnonSafeUser;
    return results.map((a) => Object.assign(a, { author: toUser(a.author) }));
  }

  async findOne(id: number, isAuthenticated = false) {
    const a = await this.prisma.announcements.findFirst({
      where: { id, status: AnnouncementStatus.PUBLISHED },
      include: FULL_INCLUDE,
    });
    if (!a) throw new NotFoundException(`Announcement ${id} not found`);
    a.comments = a.comments.filter((c) => !c.deletedAt);
    return this.sanitizeAnnouncement(a, isAuthenticated);
  }

  async findAllAdmin() {
    const results = await this.prisma.announcements.findMany({
      include: { city: true, author: true },
      orderBy: { createdAt: 'desc' },
    });
    return results.map((a) => Object.assign(a, { author: toPublicUser(a.author) }));
  }

  async findOneAdmin(id: number) {
    const a = await this.prisma.announcements.findUnique({
      where: { id },
      include: FULL_INCLUDE,
    });
    if (!a) throw new NotFoundException(`Announcement ${id} not found`);
    return this.sanitizeAnnouncement(a, true);
  }

  // isAuthenticated: false means a fully anonymous caller — uploaded profile
  // photos require a login to view, so those get nulled out here rather than
  // 401ing in the visitor's browser. Preset avatars are unaffected either way.
  private sanitizeAnnouncement(a: AnnouncementWithRelations, isAuthenticated: boolean) {
    const toUser = isAuthenticated ? toPublicUser : toAnonSafeUser;
    for (const c of a.comments ?? []) {
      (c as any).user = toUser(c.user);
    }
    return Object.assign(a, { author: toUser(a.author) });
  }

  async create(dto: CreateAnnouncementDto, userId: number) {
    return this.prisma.announcements.create({
      data: {
        title: dto.title,
        body: sanitizeHtml(dto.body, ALLOWED_HTML),
        cityId: dto.cityId ?? null,
        createdBy: userId,
      },
    });
  }

  async update(id: number, dto: Partial<CreateAnnouncementDto>) {
    const a = await this.prisma.announcements.findUnique({ where: { id } });
    if (!a) throw new NotFoundException(`Announcement ${id} not found`);
    return this.prisma.announcements.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.body !== undefined && { body: sanitizeHtml(dto.body, ALLOWED_HTML) }),
        ...(dto.cityId !== undefined && { cityId: dto.cityId }),
      },
    });
  }

  async publish(id: number) {
    const a = await this.prisma.announcements.findUnique({
      where: { id },
      include: { city: true },
    });
    if (!a) throw new NotFoundException(`Announcement ${id} not found`);
    if (a.status === AnnouncementStatus.PUBLISHED) return a;
    const saved = await this.prisma.announcements.update({
      where: { id },
      data: { status: AnnouncementStatus.PUBLISHED, publishedAt: new Date() },
    });

    const pushPayload = {
      title: a.title,
      body: 'New announcement from {{brand}}',
      url: `/announcements/${a.id}`,
    };
    if (a.cityId) {
      await this.pushService.sendToCity(a.cityId, pushPayload);
    } else {
      await this.pushService.sendToAll(pushPayload);
    }

    return saved;
  }

  async delete(id: number) {
    const a = await this.prisma.announcements.findUnique({ where: { id } });
    if (!a) throw new NotFoundException(`Announcement ${id} not found`);
    await this.prisma.announcements.delete({ where: { id } });
  }

  async addComment(announcementId: number, userId: number, dto: CreateCommentDto) {
    const a = await this.prisma.announcements.findFirst({
      where: { id: announcementId, status: AnnouncementStatus.PUBLISHED },
    });
    if (!a) throw new NotFoundException(`Announcement ${announcementId} not found`);
    return this.prisma.announcement_comments.create({
      data: { announcementId, userId, body: dto.body },
    });
  }

  // Author-only, deliberately unlike deleteComment (which moderators can do):
  // editing leaves the member's name on words they didn't write.
  async editComment(commentId: number, userId: number, dto: CreateCommentDto) {
    const comment = await this.prisma.announcement_comments.findUnique({
      where: { id: commentId },
    });
    if (!comment || comment.deletedAt) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId) {
      throw new ForbiddenException('Cannot edit another member\'s comment');
    }

    return this.prisma.announcement_comments.update({
      where: { id: commentId },
      data: { body: dto.body, editedAt: new Date() },
    });
  }

  async deleteComment(commentId: number, userId: number, userRole: UserRole) {
    const comment = await this.prisma.announcement_comments.findUnique({
      where: { id: commentId },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId && userRole === UserRole.MEMBER) {
      throw new ForbiddenException('Cannot delete another member\'s comment');
    }
    await this.prisma.announcement_comments.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
  }

  async flagContent(dto: FlagContentDto, reportedBy: number) {
    const existing = await this.prisma.content_flags.findFirst({
      where: { contentType: dto.contentType, contentId: dto.contentId, reportedBy },
    });
    if (existing) return existing;
    const saved = await this.prisma.content_flags.create({
      data: {
        contentType: dto.contentType,
        contentId: dto.contentId,
        reportedBy,
        reason: dto.reason ?? null,
      },
    });

    const mods = await this.prisma.users.findMany({
      where: { role: { in: [...ELEVATED_ROLES] } },
      select: { id: true },
    });
    await Promise.all(
      mods.map(async (mod) => {
        await this.notificationsService.create({
          userId: mod.id,
          type: 'content_flag',
          title: 'Content flagged for review',
          body: dto.reason ?? undefined,
          actionUrl: '/admin/moderation',
        });
        await this.pushService.sendToUser(mod.id, {
          title: 'Content flagged for review',
          body: dto.reason ?? 'A member flagged content for moderation.',
          url: '/admin/moderation',
        });
      }),
    );

    return saved;
  }

  async getPendingFlags() {
    const flags = await this.prisma.content_flags.findMany({
      where: { status: FlagStatus.PENDING },
      include: { reporter: true },
      orderBy: { createdAt: 'asc' },
    });
    return flags.map((f) => Object.assign(f, { reporter: toPublicUser(f.reporter) }));
  }

  async getAllFlags() {
    const flags = await this.prisma.content_flags.findMany({
      include: { reporter: true, reviewer: true },
      orderBy: { createdAt: 'desc' },
    });
    return flags.map((f) => Object.assign(f, { reporter: toPublicUser(f.reporter), reviewer: toPublicUser(f.reviewer) }));
  }

  async resolveFlag(flagId: number, reviewerId: number, status: FlagStatus) {
    const flag = await this.prisma.content_flags.findUnique({ where: { id: flagId } });
    if (!flag) throw new NotFoundException('Flag not found');
    return this.prisma.content_flags.update({
      where: { id: flagId },
      data: { status, reviewedBy: reviewerId, reviewedAt: new Date() },
    });
  }

  countPendingFlags(): Promise<number> {
    return this.prisma.content_flags.count({ where: { status: FlagStatus.PENDING } });
  }
}
