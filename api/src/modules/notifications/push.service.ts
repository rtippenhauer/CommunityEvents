import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import type { push_subscriptions as PushSubscription } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UserStatus } from '../../database/enums';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const subject = this.config.get<string>('VAPID_SUBJECT');
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    if (subject && publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.enabled = true;
    } else {
      this.logger.warn('VAPID keys not configured — push notifications disabled');
    }
  }

  async subscribe(userId: number, endpoint: string, p256dh: string, auth: string): Promise<void> {
    await this.prisma.push_subscriptions.upsert({
      where: { endpoint },
      update: { userId, p256dh, auth },
      create: { userId, endpoint, p256dh, auth },
    });
  }

  async unsubscribe(userId: number, endpoint: string): Promise<void> {
    // deleteMany rather than delete: endpoint alone is the unique key, but the
    // userId has to stay in the criteria so one member cannot remove another's
    // subscription by guessing an endpoint.
    await this.prisma.push_subscriptions.deleteMany({ where: { userId, endpoint } });
  }

  async sendToUser(userId: number, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    const subs = await this.prisma.push_subscriptions.findMany({ where: { userId } });
    await this.sendToSubscriptions(subs, payload);
  }

  async sendToCity(cityId: number, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    const subs = await this.prisma.push_subscriptions.findMany({
      where: { user: { cityId, status: UserStatus.ACTIVE } },
    });
    await this.sendToSubscriptions(subs, payload);
  }

  async sendToAll(payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    const subs = await this.prisma.push_subscriptions.findMany({
      where: { user: { status: UserStatus.ACTIVE } },
    });
    await this.sendToSubscriptions(subs, payload);
  }

  private async sendToSubscriptions(
    subs: PushSubscription[],
    payload: PushPayload,
  ): Promise<void> {
    if (!subs.length) {
      this.logger.debug('sendToSubscriptions: no subscriptions to notify');
      return;
    }
    this.logger.log(`Sending push to ${subs.length} subscription(s): "${payload.title}"`);
    const body = JSON.stringify({
      notification: {
        title: payload.title,
        body: payload.body,
        icon: '/assets/logo.png',
        badge: '/assets/logo.png',
        ...(payload.url && { data: { url: payload.url } }),
      },
    });
    const stale: number[] = [];
    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
          );
          this.logger.debug(`Push delivered to sub ${sub.id} (user ${sub.userId})`);
        } catch (err: any) {
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            this.logger.log(`Push sub ${sub.id} expired (${err.statusCode}), removing`);
            stale.push(sub.id);
          } else {
            this.logger.warn(
              `Push failed for sub ${sub.id} (user ${sub.userId}): HTTP ${err?.statusCode} — ${err?.message}`,
            );
          }
        }
      }),
    );
    if (stale.length) {
      await this.prisma.push_subscriptions.deleteMany({ where: { id: { in: stale } } });
    }
  }
}
