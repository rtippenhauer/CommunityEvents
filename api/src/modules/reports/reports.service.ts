import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import {
  ReportContentType,
  ReportStatus,
} from '../../database/enums';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ReviewAction, ReviewReportDto } from './dto/review-report.dto';
import { ELEVATED_ROLES } from '../../common/utils/roles.util';

interface ContentInfo {
  authorId: number;
  preview: string;
  label: string;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(reporterId: number, dto: CreateReportDto): Promise<void> {
    const info = await this.getContentInfo(dto.contentType, dto.contentId);

    if (info.authorId === reporterId) {
      throw new ForbiddenException('You cannot report your own content');
    }

    const existing = await this.prisma.content_reports.findFirst({
      where: { reporterId, contentType: dto.contentType, contentId: dto.contentId },
    });
    if (existing) throw new ConflictException('You have already reported this content');

    await this.prisma.content_reports.create({
      data: {
        reporterId,
        contentType: dto.contentType,
        contentId: dto.contentId,
        reason: dto.reason ?? null,
      },
    });

    void this.notifyMods(info.label, info.preview);
  }

  async getPendingCount(): Promise<number> {
    return this.prisma.content_reports.count({ where: { status: ReportStatus.PENDING } });
  }

  async getAdminReports(): Promise<object[]> {
    const reports = await this.prisma.content_reports.findMany({
      where: { status: ReportStatus.PENDING },
      include: { reporter: true },
      orderBy: { createdAt: 'asc' },
    });

    return Promise.all(
      reports.map(async (r) => {
        let preview = '';
        let label = '';
        try {
          // Prisma types the column as a string union of the same values;
          // TypeScript enums are nominal, so the cast is the bridge between
          // the generated type and the domain enum. Values are identical.
          const info = await this.getContentInfo(
            r.contentType as ReportContentType,
            r.contentId,
          );
          preview = info.preview;
          label = info.label;
        } catch {
          preview = '[Content no longer exists]';
          label = r.contentType;
        }
        return {
          id: r.id,
          contentType: r.contentType,
          contentId: r.contentId,
          contentLabel: label,
          contentPreview: preview,
          reason: r.reason,
          reportedBy: { id: r.reporter.id, fullName: r.reporter.fullName },
          createdAt: r.createdAt,
        };
      }),
    );
  }

  async review(id: number, reviewerId: number, dto: ReviewReportDto): Promise<void> {
    const report = await this.prisma.content_reports.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== ReportStatus.PENDING) {
      throw new ConflictException('Report has already been reviewed');
    }

    if (dto.action === ReviewAction.DELETE_AND_DISMISS) {
      await this.deleteContent(report.contentType as ReportContentType, report.contentId);
    }

    await this.prisma.content_reports.update({
      where: { id },
      data: {
        status:
          dto.action === ReviewAction.DELETE_AND_DISMISS
            ? ReportStatus.REVIEWED
            : ReportStatus.DISMISSED,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });
  }

  private async getContentInfo(type: ReportContentType, id: number): Promise<ContentInfo> {
    switch (type) {
      case ReportContentType.EVENT_COMMENT: {
        const c = await this.prisma.event_comments.findUnique({ where: { id } });
        if (!c || c.deletedAt) throw new NotFoundException('Content not found');
        return { authorId: c.memberId, preview: c.body.slice(0, 120), label: 'Event comment' };
      }
      case ReportContentType.EVENT_COMMENT_REPLY: {
        const r = await this.prisma.event_comment_replies.findUnique({ where: { id } });
        if (!r || r.deletedAt) throw new NotFoundException('Content not found');
        return { authorId: r.memberId, preview: r.body.slice(0, 120), label: 'Event reply' };
      }
      case ReportContentType.ANNOUNCEMENT_COMMENT: {
        const a = await this.prisma.announcement_comments.findUnique({ where: { id } });
        if (!a || a.deletedAt) throw new NotFoundException('Content not found');
        return { authorId: a.userId, preview: a.body.slice(0, 120), label: 'Announcement comment' };
      }
      case ReportContentType.LOCATION_RATING: {
        const r = await this.prisma.location_ratings.findUnique({ where: { id } });
        if (!r) throw new NotFoundException('Content not found');
        const text = r.comment ?? `Food ${r.food}★ Service ${r.service}★ Value ${r.valueRating}★ Noise ${r.noise}★`;
        return { authorId: r.memberId, preview: text.slice(0, 120), label: 'Restaurant rating' };
      }
    }
  }

  private async deleteContent(type: ReportContentType, id: number): Promise<void> {
    switch (type) {
      case ReportContentType.EVENT_COMMENT:
        await this.prisma.event_comments.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        break;
      case ReportContentType.EVENT_COMMENT_REPLY:
        await this.prisma.event_comment_replies.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        break;
      case ReportContentType.ANNOUNCEMENT_COMMENT:
        await this.prisma.announcement_comments.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
        break;
      case ReportContentType.LOCATION_RATING:
        await this.prisma.location_ratings.delete({ where: { id } });
        break;
    }
  }

  private async notifyMods(label: string, preview: string): Promise<void> {
    // TypeORM's array-of-where was an OR across roles; `in` says the same
    // thing directly.
    const mods = await this.prisma.users.findMany({
      where: { role: { in: [...ELEVATED_ROLES] } },
      select: { id: true },
    });

    const actionUrl = `/admin/reports`;
    const body = `"${preview.slice(0, 80)}${preview.length > 80 ? '…' : ''}"`;

    await Promise.all(
      mods.map((m) =>
        this.notificationsService.create({
          userId: m.id,
          type: 'content_reported',
          title: `${label} reported`,
          body,
          actionUrl,
        }),
      ),
    );
  }
}
