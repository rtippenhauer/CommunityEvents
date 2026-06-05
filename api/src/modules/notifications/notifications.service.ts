import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationEntity } from '../../database/entities/notification.entity';

export interface CreateNotificationParams {
  userId: number;
  type: string;
  title: string;
  body?: string;
  actionUrl?: string;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
  ) {}

  async create(params: CreateNotificationParams): Promise<NotificationEntity> {
    const notification = this.notificationRepo.create({
      userId: params.userId,
      type: params.type,
      title: params.title,
      body: params.body ?? null,
      actionUrl: params.actionUrl ?? null,
    });
    return this.notificationRepo.save(notification);
  }

  findForUser(userId: number): Promise<NotificationEntity[]> {
    return this.notificationRepo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async markRead(id: number, userId: number): Promise<void> {
    await this.notificationRepo.update({ id, userId }, { isRead: true, readAt: new Date() });
  }

  async markAllRead(userId: number): Promise<void> {
    await this.notificationRepo.update(
      { userId, isRead: false },
      { isRead: true, readAt: new Date() },
    );
  }

  countUnread(userId: number): Promise<number> {
    return this.notificationRepo.count({ where: { userId, isRead: false } });
  }
}
