import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ContentReportEntity,
  ReportContentType,
  ReportStatus,
} from '../../database/entities/content-report.entity';
import { EventCommentEntity } from '../../database/entities/event-comment.entity';
import { EventCommentReplyEntity } from '../../database/entities/event-comment-reply.entity';
import { AnnouncementCommentEntity } from '../../database/entities/announcement-comment.entity';
import { LocationRatingEntity } from '../../database/entities/location-rating.entity';
import { UserEntity, UserRole } from '../../database/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateReportDto } from './dto/create-report.dto';
import { ReviewAction, ReviewReportDto } from './dto/review-report.dto';

interface ContentInfo {
  authorId: number;
  preview: string;
  label: string;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(ContentReportEntity)
    private readonly reportRepo: Repository<ContentReportEntity>,
    @InjectRepository(EventCommentEntity)
    private readonly commentRepo: Repository<EventCommentEntity>,
    @InjectRepository(EventCommentReplyEntity)
    private readonly replyRepo: Repository<EventCommentReplyEntity>,
    @InjectRepository(AnnouncementCommentEntity)
    private readonly annoCommentRepo: Repository<AnnouncementCommentEntity>,
    @InjectRepository(LocationRatingEntity)
    private readonly ratingRepo: Repository<LocationRatingEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(reporterId: number, dto: CreateReportDto): Promise<void> {
    const info = await this.getContentInfo(dto.contentType, dto.contentId);

    if (info.authorId === reporterId) {
      throw new ForbiddenException('You cannot report your own content');
    }

    const existing = await this.reportRepo.findOne({
      where: { reporterId, contentType: dto.contentType, contentId: dto.contentId },
    });
    if (existing) throw new ConflictException('You have already reported this content');

    await this.reportRepo.save(
      this.reportRepo.create({
        reporterId,
        contentType: dto.contentType,
        contentId: dto.contentId,
        reason: dto.reason ?? null,
      }),
    );

    void this.notifyMods(info.label, info.preview);
  }

  async getPendingCount(): Promise<number> {
    return this.reportRepo.count({ where: { status: ReportStatus.PENDING } });
  }

  async getAdminReports(): Promise<object[]> {
    const reports = await this.reportRepo.find({
      where: { status: ReportStatus.PENDING },
      relations: ['reporter'],
      order: { createdAt: 'ASC' },
    });

    return Promise.all(
      reports.map(async (r) => {
        let preview = '';
        let label = '';
        try {
          const info = await this.getContentInfo(r.contentType, r.contentId);
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
    const report = await this.reportRepo.findOne({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== ReportStatus.PENDING) {
      throw new ConflictException('Report has already been reviewed');
    }

    if (dto.action === ReviewAction.DELETE_AND_DISMISS) {
      await this.deleteContent(report.contentType, report.contentId);
    }

    await this.reportRepo.update(id, {
      status: dto.action === ReviewAction.DELETE_AND_DISMISS
        ? ReportStatus.REVIEWED
        : ReportStatus.DISMISSED,
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
    });
  }

  private async getContentInfo(type: ReportContentType, id: number): Promise<ContentInfo> {
    switch (type) {
      case ReportContentType.EVENT_COMMENT: {
        const c = await this.commentRepo.findOne({ where: { id } });
        if (!c || c.deletedAt) throw new NotFoundException('Content not found');
        return { authorId: c.memberId, preview: c.body.slice(0, 120), label: 'Event comment' };
      }
      case ReportContentType.EVENT_COMMENT_REPLY: {
        const r = await this.replyRepo.findOne({ where: { id } });
        if (!r || r.deletedAt) throw new NotFoundException('Content not found');
        return { authorId: r.memberId, preview: r.body.slice(0, 120), label: 'Event reply' };
      }
      case ReportContentType.ANNOUNCEMENT_COMMENT: {
        const a = await this.annoCommentRepo.findOne({ where: { id } });
        if (!a || a.deletedAt) throw new NotFoundException('Content not found');
        return { authorId: a.userId, preview: a.body.slice(0, 120), label: 'Announcement comment' };
      }
      case ReportContentType.LOCATION_RATING: {
        const r = await this.ratingRepo.findOne({ where: { id } });
        if (!r) throw new NotFoundException('Content not found');
        const text = r.comment ?? `Food ${r.food}★ Service ${r.service}★ Value ${r.valueRating}★ Noise ${r.noise}★`;
        return { authorId: r.memberId, preview: text.slice(0, 120), label: 'Restaurant rating' };
      }
    }
  }

  private async deleteContent(type: ReportContentType, id: number): Promise<void> {
    switch (type) {
      case ReportContentType.EVENT_COMMENT:
        await this.commentRepo.update(id, { deletedAt: new Date() });
        break;
      case ReportContentType.EVENT_COMMENT_REPLY:
        await this.replyRepo.update(id, { deletedAt: new Date() });
        break;
      case ReportContentType.ANNOUNCEMENT_COMMENT:
        await this.annoCommentRepo.update(id, { deletedAt: new Date() });
        break;
      case ReportContentType.LOCATION_RATING:
        await this.ratingRepo.delete(id);
        break;
    }
  }

  private async notifyMods(label: string, preview: string): Promise<void> {
    const mods = await this.userRepo.find({
      where: [{ role: UserRole.ADMIN }, { role: UserRole.MODERATOR }],
      select: ['id'],
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
