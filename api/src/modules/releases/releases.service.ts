import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ReleaseEntity } from '../../database/entities/release.entity';
import { FeedbackEntity, FeedbackStatus } from '../../database/entities/feedback.entity';
import { CreateReleaseDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
import * as sanitizeHtml from 'sanitize-html';

const ALLOWED_HTML = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['s', 'u']),
  allowedAttributes: { a: ['href', 'target', 'rel'], ...sanitizeHtml.defaults.allowedAttributes },
};

@Injectable()
export class ReleasesService {
  constructor(
    @InjectRepository(ReleaseEntity)
    private readonly releaseRepo: Repository<ReleaseEntity>,
    @InjectRepository(FeedbackEntity)
    private readonly feedbackRepo: Repository<FeedbackEntity>,
  ) {}

  // ── Public ────────────────────────────────────────────────────────────────

  async findPublished(): Promise<ReleaseEntity[]> {
    return this.releaseRepo.find({
      where: { publishedAt: undefined },
      relations: ['linkedFeedback', 'author'],
      order: { publishedAt: 'DESC' },
    });
  }

  async findPublishedList(): Promise<ReleaseEntity[]> {
    const qb = this.releaseRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.linkedFeedback', 'fb')
      .leftJoinAndSelect('r.author', 'author')
      .where('r.published_at IS NOT NULL')
      .orderBy('r.published_at', 'DESC');
    return qb.getMany();
  }

  async findOnePublished(id: number): Promise<ReleaseEntity> {
    const release = await this.releaseRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.linkedFeedback', 'fb')
      .leftJoinAndSelect('fb.user', 'fbUser')
      .leftJoinAndSelect('r.author', 'author')
      .where('r.id = :id AND r.published_at IS NOT NULL', { id })
      .getOne();
    if (!release) throw new NotFoundException(`Release ${id} not found`);
    return release;
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  async findAll(): Promise<ReleaseEntity[]> {
    return this.releaseRepo.find({
      relations: ['linkedFeedback', 'author'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOneAdmin(id: number): Promise<ReleaseEntity> {
    const release = await this.releaseRepo.findOne({
      where: { id },
      relations: ['linkedFeedback', 'linkedFeedback.user', 'author'],
    });
    if (!release) throw new NotFoundException(`Release ${id} not found`);
    return release;
  }

  async create(dto: CreateReleaseDto, authorId: number): Promise<ReleaseEntity> {
    const existing = await this.releaseRepo.findOne({ where: { version: dto.version } });
    if (existing) throw new ConflictException(`Version ${dto.version} already exists`);

    const release = this.releaseRepo.create({
      version: dto.version,
      title: dto.title,
      body: sanitizeHtml(dto.body, ALLOWED_HTML),
      createdBy: authorId,
    });

    if (dto.feedbackIds?.length) {
      const feedbackItems = await this.feedbackRepo.find({
        where: { id: In(dto.feedbackIds) },
      });
      release.linkedFeedback = feedbackItems;
    }

    return this.releaseRepo.save(release);
  }

  async update(id: number, dto: UpdateReleaseDto): Promise<ReleaseEntity> {
    const release = await this.releaseRepo.findOne({
      where: { id },
      relations: ['linkedFeedback'],
    });
    if (!release) throw new NotFoundException(`Release ${id} not found`);
    if (release.publishedAt) throw new BadRequestException('Cannot edit a published release');

    if (dto.version !== undefined) {
      const conflict = await this.releaseRepo.findOne({ where: { version: dto.version } });
      if (conflict && conflict.id !== id) throw new ConflictException(`Version ${dto.version} already exists`);
      release.version = dto.version;
    }
    if (dto.title !== undefined) release.title = dto.title;
    if (dto.body !== undefined) release.body = sanitizeHtml(dto.body, ALLOWED_HTML);

    if (dto.feedbackIds !== undefined) {
      release.linkedFeedback = dto.feedbackIds.length
        ? await this.feedbackRepo.find({ where: { id: In(dto.feedbackIds) } })
        : [];
    }

    return this.releaseRepo.save(release);
  }

  async publish(id: number): Promise<ReleaseEntity> {
    const release = await this.releaseRepo.findOne({
      where: { id },
      relations: ['linkedFeedback'],
    });
    if (!release) throw new NotFoundException(`Release ${id} not found`);
    if (release.publishedAt) return release;

    release.publishedAt = new Date();
    const saved = await this.releaseRepo.save(release);

    // Mark linked resolved feedback as shipped
    if (release.linkedFeedback?.length) {
      const ids = release.linkedFeedback.map((fb) => fb.id);
      await this.feedbackRepo
        .createQueryBuilder()
        .update()
        .set({ status: FeedbackStatus.SHIPPED, resolvedAt: () => 'COALESCE(resolved_at, NOW())' })
        .whereInIds(ids)
        .execute();
    }

    return saved;
  }

  async getResolvedFeedback(): Promise<FeedbackEntity[]> {
    return this.feedbackRepo.find({
      where: { status: FeedbackStatus.RESOLVED },
      relations: ['user'],
      order: { updatedAt: 'DESC' },
    });
  }
}
