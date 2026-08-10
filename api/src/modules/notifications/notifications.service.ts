import { Injectable } from '@nestjs/common';
import type { notifications as Notification } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';

export interface CreateNotificationParams {
  userId: number;
  type: string;
  title: string;
  body?: string;
  actionUrl?: string;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: CreateNotificationParams): Promise<Notification> {
    return this.prisma.notifications.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body ?? null,
        actionUrl: params.actionUrl ?? null,
      },
    });
  }

  findForUser(userId: number): Promise<Notification[]> {
    return this.prisma.notifications.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(id: number, userId: number): Promise<void> {
    // updateMany, not update: the userId in the criteria is an ownership check,
    // and update() only accepts a unique selector so it could not carry it.
    await this.prisma.notifications.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  async markAllRead(userId: number): Promise<void> {
    await this.prisma.notifications.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  countUnread(userId: number): Promise<number> {
    return this.prisma.notifications.count({ where: { userId, isRead: false } });
  }
}
