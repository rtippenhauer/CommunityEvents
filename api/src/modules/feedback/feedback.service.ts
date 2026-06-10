import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { FeedbackEntity } from '../../database/entities/feedback.entity';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { UpdateFeedbackDto } from './dto/update-feedback.dto';

@Injectable()
export class FeedbackService {
  constructor(
    @InjectRepository(FeedbackEntity)
    private readonly feedbackRepo: Repository<FeedbackEntity>,
  ) {}

  async create(dto: CreateFeedbackDto, userId: number): Promise<FeedbackEntity> {
    const item = this.feedbackRepo.create({
      userId,
      category: dto.category,
      body: dto.body,
    });
    return this.feedbackRepo.save(item);
  }

  async findAll(): Promise<FeedbackEntity[]> {
    return this.feedbackRepo.find({
      relations: ['user'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: number): Promise<FeedbackEntity> {
    const item = await this.feedbackRepo.findOne({ where: { id }, relations: ['user'] });
    if (!item) throw new NotFoundException(`Feedback ${id} not found`);
    return item;
  }

  async update(id: number, dto: UpdateFeedbackDto): Promise<FeedbackEntity> {
    const item = await this.findOne(id);
    if (dto.status !== undefined) item.status = dto.status;
    if (dto.adminNote !== undefined) item.adminNote = dto.adminNote ?? null;
    return this.feedbackRepo.save(item);
  }

  async getUnseenCount(): Promise<number> {
    return this.feedbackRepo.count({ where: { seenAt: IsNull() } });
  }

  async markSeen(id: number): Promise<FeedbackEntity> {
    const item = await this.findOne(id);
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
}
