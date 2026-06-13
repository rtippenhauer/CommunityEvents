import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as webpush from 'web-push';
import { PushSubscriptionEntity } from '../../database/entities/push-subscription.entity';

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
    @InjectRepository(PushSubscriptionEntity)
    private readonly subRepo: Repository<PushSubscriptionEntity>,
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
    await this.subRepo.upsert(
      { userId, endpoint, p256dh, auth },
      { conflictPaths: ['endpoint'] },
    );
  }

  async unsubscribe(userId: number, endpoint: string): Promise<void> {
    await this.subRepo.delete({ userId, endpoint });
  }

  async sendToUser(userId: number, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    const subs = await this.subRepo.find({ where: { userId } });
    await this.sendToSubscriptions(subs, payload);
  }

  async sendToCity(cityId: number, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    const subs = await this.subRepo
      .createQueryBuilder('s')
      .innerJoin('s.user', 'u')
      .where('u.city_id = :cityId AND u.status = :status', { cityId, status: 'active' })
      .getMany();
    await this.sendToSubscriptions(subs, payload);
  }

  async sendToAll(payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    const subs = await this.subRepo
      .createQueryBuilder('s')
      .innerJoin('s.user', 'u')
      .where('u.status = :status', { status: 'active' })
      .getMany();
    await this.sendToSubscriptions(subs, payload);
  }

  private async sendToSubscriptions(
    subs: PushSubscriptionEntity[],
    payload: PushPayload,
  ): Promise<void> {
    const body = JSON.stringify({
      notification: {
        title: payload.title,
        body: payload.body,
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
        } catch (err: any) {
          if (err?.statusCode === 410 || err?.statusCode === 404) {
            stale.push(sub.id);
          } else {
            this.logger.warn(`Push failed for sub ${sub.id}: ${err?.message}`);
          }
        }
      }),
    );
    if (stale.length) {
      await this.subRepo.delete(stale);
    }
  }
}
