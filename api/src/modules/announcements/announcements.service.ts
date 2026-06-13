import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AnnouncementEntity, AnnouncementStatus } from '../../database/entities/announcement.entity';
import { AnnouncementCommentEntity } from '../../database/entities/announcement-comment.entity';
import { ContentFlagEntity, FlagContentType, FlagStatus } from '../../database/entities/content-flag.entity';
import { UserEntity, UserRole } from '../../database/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../notifications/push.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { CreateCommentDto } from './dto/create-comment.dto';
import { FlagContentDto } from './dto/flag-content.dto';

@Injectable()
export class AnnouncementsService {
  constructor(
    @InjectRepository(AnnouncementEntity)
    private readonly announcementRepo: Repository<AnnouncementEntity>,
    @InjectRepository(AnnouncementCommentEntity)
    private readonly commentRepo: Repository<AnnouncementCommentEntity>,
    @InjectRepository(ContentFlagEntity)
    private readonly flagRepo: Repository<ContentFlagEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushService,
  ) {}

  findPublished(cityId?: number) {
    const qb = this.announcementRepo
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.city', 'city')
      .leftJoinAndSelect('a.author', 'author')
      .where('a.status = :status', { status: AnnouncementStatus.PUBLISHED })
      .orderBy('a.published_at', 'DESC');
    if (cityId) {
      qb.andWhere('(a.city_id = :cityId OR a.city_id IS NULL)', { cityId });
    }
    return qb.getMany();
  }

  async findOne(id: number) {
    const a = await this.announcementRepo.findOne({
      where: { id, status: AnnouncementStatus.PUBLISHED },
      relations: ['city', 'author', 'comments', 'comments.user'],
    });
    if (!a) throw new NotFoundException(`Announcement ${id} not found`);
    a.comments = a.comments.filter((c) => !c.deletedAt);
    return a;
  }

  findAllAdmin() {
    return this.announcementRepo.find({
      relations: ['city', 'author'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOneAdmin(id: number) {
    const a = await this.announcementRepo.findOne({
      where: { id },
      relations: ['city', 'author', 'comments', 'comments.user'],
    });
    if (!a) throw new NotFoundException(`Announcement ${id} not found`);
    return a;
  }

  async create(dto: CreateAnnouncementDto, userId: number) {
    const a = this.announcementRepo.create({
      title: dto.title,
      body: dto.body,
      cityId: dto.cityId ?? null,
      createdBy: userId,
    });
    return this.announcementRepo.save(a);
  }

  async update(id: number, dto: Partial<CreateAnnouncementDto>) {
    const a = await this.announcementRepo.findOne({ where: { id } });
    if (!a) throw new NotFoundException(`Announcement ${id} not found`);
    Object.assign(a, {
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.body !== undefined && { body: dto.body }),
      ...(dto.cityId !== undefined && { cityId: dto.cityId }),
    });
    return this.announcementRepo.save(a);
  }

  async publish(id: number) {
    const a = await this.announcementRepo.findOne({ where: { id }, relations: ['city'] });
    if (!a) throw new NotFoundException(`Announcement ${id} not found`);
    if (a.status === AnnouncementStatus.PUBLISHED) return a;
    a.status = AnnouncementStatus.PUBLISHED;
    a.publishedAt = new Date();
    const saved = await this.announcementRepo.save(a);

    const pushPayload = {
      title: a.title,
      body: 'New announcement from DinnerBears',
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
    const a = await this.announcementRepo.findOne({ where: { id } });
    if (!a) throw new NotFoundException(`Announcement ${id} not found`);
    await this.announcementRepo.remove(a);
  }

  async addComment(announcementId: number, userId: number, dto: CreateCommentDto) {
    const a = await this.announcementRepo.findOne({
      where: { id: announcementId, status: AnnouncementStatus.PUBLISHED },
    });
    if (!a) throw new NotFoundException(`Announcement ${announcementId} not found`);
    const comment = this.commentRepo.create({ announcementId, userId, body: dto.body });
    return this.commentRepo.save(comment);
  }

  async deleteComment(commentId: number, userId: number, userRole: UserRole) {
    const comment = await this.commentRepo.findOne({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId && userRole === UserRole.MEMBER) {
      throw new ForbiddenException('Cannot delete another member\'s comment');
    }
    comment.deletedAt = new Date();
    await this.commentRepo.save(comment);
  }

  async flagContent(dto: FlagContentDto, reportedBy: number) {
    const existing = await this.flagRepo.findOne({
      where: { contentType: dto.contentType, contentId: dto.contentId, reportedBy },
    });
    if (existing) return existing;
    const flag = this.flagRepo.create({
      contentType: dto.contentType,
      contentId: dto.contentId,
      reportedBy,
      reason: dto.reason ?? null,
    });
    const saved = await this.flagRepo.save(flag);

    const mods = await this.userRepo.find({
      where: { role: In([UserRole.ADMIN, UserRole.MODERATOR]) },
      select: ['id'],
    });
    await Promise.all(
      mods.map((mod) =>
        this.notificationsService.create({
          userId: mod.id,
          type: 'content_flag',
          title: 'Content flagged for review',
          body: dto.reason ?? undefined,
          actionUrl: '/admin/moderation',
        }),
      ),
    );

    return saved;
  }

  getPendingFlags() {
    return this.flagRepo.find({
      where: { status: FlagStatus.PENDING },
      relations: ['reporter'],
      order: { createdAt: 'ASC' },
    });
  }

  getAllFlags() {
    return this.flagRepo.find({
      relations: ['reporter', 'reviewer'],
      order: { createdAt: 'DESC' },
    });
  }

  async resolveFlag(flagId: number, reviewerId: number, status: FlagStatus) {
    const flag = await this.flagRepo.findOne({ where: { id: flagId } });
    if (!flag) throw new NotFoundException('Flag not found');
    flag.status = status;
    flag.reviewedBy = reviewerId;
    flag.reviewedAt = new Date();
    return this.flagRepo.save(flag);
  }

  countPendingFlags(): Promise<number> {
    return this.flagRepo.count({ where: { status: FlagStatus.PENDING } });
  }
}
