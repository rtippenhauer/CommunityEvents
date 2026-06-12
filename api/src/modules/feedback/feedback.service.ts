import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { FeedbackEntity, FeedbackCategory, FeedbackStatus } from '../../database/entities/feedback.entity';
import { FeedbackNoteEntity } from '../../database/entities/feedback-note.entity';
import { FeedbackUpvoteEntity } from '../../database/entities/feedback-upvote.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import * as sanitizeHtml from 'sanitize-html';

const ALLOWED_HTML = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['s', 'u']),
  allowedAttributes: { a: ['href', 'target', 'rel'], ...sanitizeHtml.defaults.allowedAttributes },
};

@Injectable()
export class FeedbackService {
  constructor(
    @InjectRepository(FeedbackEntity)
    private readonly feedbackRepo: Repository<FeedbackEntity>,
    @InjectRepository(FeedbackNoteEntity)
    private readonly noteRepo: Repository<FeedbackNoteEntity>,
    @InjectRepository(FeedbackUpvoteEntity)
    private readonly upvoteRepo: Repository<FeedbackUpvoteEntity>,
  ) {}

  // ── Member: Create ────────────────────────────────────────────────────────

  async create(dto: CreateFeedbackDto, userId: number): Promise<FeedbackEntity> {
    const item = this.feedbackRepo.create({
      userId,
      title: dto.title,
      category: dto.category,
      body: sanitizeHtml(dto.body, ALLOWED_HTML),
      isPrivate: dto.isPrivate ?? false,
    });
    return this.feedbackRepo.save(item);
  }

  // ── Member: List ──────────────────────────────────────────────────────────

  async findPublic(
    currentUserId: number,
    category?: FeedbackCategory,
    sort: 'newest' | 'upvotes' = 'newest',
  ): Promise<(FeedbackEntity & { hasUpvoted: boolean })[]> {
    const qb = this.feedbackRepo
      .createQueryBuilder('fb')
      .leftJoinAndSelect('fb.user', 'user')
      .where('(fb.is_private = 0 OR fb.user_id = :uid)', { uid: currentUserId });

    if (category) qb.andWhere('fb.category = :cat', { cat: category });

    if (sort === 'upvotes') {
      qb.orderBy('fb.upvote_count', 'DESC').addOrderBy('fb.created_at', 'DESC');
    } else {
      qb.orderBy('fb.created_at', 'DESC');
    }

    const items = await qb.getMany();

    const upvoted = await this.upvoteRepo.find({ where: { memberId: currentUserId } });
    const upvotedSet = new Set(upvoted.map((u) => u.feedbackId));

    return items.map((fb) => Object.assign(fb, { hasUpvoted: upvotedSet.has(fb.id) }));
  }

  async findMine(userId: number): Promise<FeedbackEntity[]> {
    return this.feedbackRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  // ── Member: Detail ────────────────────────────────────────────────────────

  async findOne(id: number, currentUserId?: number, isAdmin = false): Promise<FeedbackEntity> {
    const item = await this.feedbackRepo.findOne({ where: { id }, relations: ['user'] });
    if (!item) throw new NotFoundException(`Feedback ${id} not found`);
    if (item.isPrivate && !isAdmin && item.userId !== currentUserId) {
      throw new ForbiddenException('This ticket is private');
    }
    return item;
  }

  // ── Member: Upvote toggle ─────────────────────────────────────────────────

  async toggleUpvote(feedbackId: number, userId: number): Promise<{ upvoteCount: number; hasUpvoted: boolean }> {
    const item = await this.feedbackRepo.findOne({ where: { id: feedbackId } });
    if (!item) throw new NotFoundException(`Feedback ${feedbackId} not found`);
    if (item.isPrivate && item.userId !== userId) throw new ForbiddenException('This ticket is private');

    const existing = await this.upvoteRepo.findOne({
      where: { feedbackId, memberId: userId },
    });

    if (existing) {
      await this.upvoteRepo.remove(existing);
      await this.feedbackRepo.decrement({ id: feedbackId }, 'upvoteCount', 1);
      const updated = await this.feedbackRepo.findOne({ where: { id: feedbackId } });
      return { upvoteCount: updated!.upvoteCount, hasUpvoted: false };
    } else {
      await this.upvoteRepo.save(this.upvoteRepo.create({ feedbackId, memberId: userId }));
      await this.feedbackRepo.increment({ id: feedbackId }, 'upvoteCount', 1);
      const updated = await this.feedbackRepo.findOne({ where: { id: feedbackId } });
      return { upvoteCount: updated!.upvoteCount, hasUpvoted: true };
    }
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  async getNotes(feedbackId: number, isAdmin: boolean): Promise<FeedbackNoteEntity[]> {
    const qb = this.noteRepo
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.author', 'author')
      .where('n.feedback_id = :fid', { fid: feedbackId });
    if (!isAdmin) qb.andWhere('n.is_admin_only = 0');
    qb.orderBy('n.created_at', 'ASC');
    return qb.getMany();
  }

  async addNote(
    feedbackId: number,
    authorId: number,
    dto: CreateNoteDto,
    isAdmin: boolean,
  ): Promise<FeedbackNoteEntity> {
    const feedback = await this.feedbackRepo.findOne({ where: { id: feedbackId } });
    if (!feedback) throw new NotFoundException(`Feedback ${feedbackId} not found`);
    if (!isAdmin && dto.isAdminOnly) throw new ForbiddenException('Only admins can post admin-only notes');

    const note = this.noteRepo.create({
      feedbackId,
      authorId,
      content: sanitizeHtml(dto.content, ALLOWED_HTML),
      isAdminOnly: isAdmin ? (dto.isAdminOnly ?? false) : false,
    });
    const saved = await this.noteRepo.save(note);
    return this.noteRepo.findOne({ where: { id: saved.id }, relations: ['author'] }) as Promise<FeedbackNoteEntity>;
  }

  // ── Admin: List / update ──────────────────────────────────────────────────

  async findAll(): Promise<FeedbackEntity[]> {
    return this.feedbackRepo.find({
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  async getOpenBugs(): Promise<FeedbackEntity[]> {
    return this.feedbackRepo.find({
      where: { category: FeedbackCategory.BUG, status: FeedbackStatus.OPEN },
      relations: ['user'],
      order: { createdAt: 'ASC' },
    });
  }

  async update(id: number, dto: UpdateFeedbackDto): Promise<FeedbackEntity> {
    const item = await this.feedbackRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Feedback ${id} not found`);
    if (dto.status !== undefined) item.status = dto.status;
    if (dto.adminNote !== undefined) item.adminNote = dto.adminNote ?? null;
    return this.feedbackRepo.save(item);
  }

  // ── Admin: Seen tracking ──────────────────────────────────────────────────

  async getUnseenCount(): Promise<number> {
    return this.feedbackRepo.count({ where: { seenAt: IsNull() } });
  }

  async markSeen(id: number): Promise<FeedbackEntity> {
    const item = await this.feedbackRepo.findOne({ where: { id } });
    if (!item) throw new NotFoundException(`Feedback ${id} not found`);
    if (!item.seenAt) {
      item.seenAt = new Date();
      return this.feedbackRepo.save(item);
    }
    return item;
  }

  async markAllSeen(): Promise<void> {
    await this.feedbackRepo
      .createQueryBuilder()
      .update()
      .set({ seenAt: new Date() })
      .where('seen_at IS NULL')
      .execute();
  }

  // ── Member: Profile stats ─────────────────────────────────────────────────

  async getMemberStats(userId: number): Promise<{
    bugsReported: number;
    featuresRequested: number;
    shippedCount: number;
  }> {
    const [bugsReported, featuresRequested, shippedCount] = await Promise.all([
      this.feedbackRepo.count({ where: { userId, category: FeedbackCategory.BUG } }),
      this.feedbackRepo.count({ where: { userId, category: FeedbackCategory.FEATURE_REQUEST } }),
      this.feedbackRepo.count({ where: { userId, status: FeedbackStatus.SHIPPED } }),
    ]);
    return { bugsReported, featuresRequested, shippedCount };
  }
}
