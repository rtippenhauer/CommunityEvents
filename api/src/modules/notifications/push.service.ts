import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import type { push_subscriptions as PushSubscription } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { UserStatus } from '../../database/enums';
import { AppConfigService } from '../app-config/app-config.service';

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
    private readonly appConfig: AppConfigService,
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
    // This community's logo, else the platform mark (v2-10). Both were
    // hardcoded to DinnerBears' /assets/logo.png with no per-tenant resolution
    // at all, so every community's notifications carried another community's
    // artwork -- unlike the email header, which at least honoured an upload.
    //
    // Safe to resolve here because every caller is request-scoped
    // (announcements and the notifications controller); nothing sends push from
    // a cron, which would have no tenant in context to read app_config with.
    //
    // `badge` is knowingly the same image. Android renders a badge as a flat
    // monochrome stencil and discards colour, so a full-colour logo becomes a
    // grey blob -- fixing that needs a dedicated monochrome asset, not a
    // different resolution.
    const logoUrl = await this.appConfig.absoluteLogoUrl();
    const body = JSON.stringify({
      notification: {
        title: payload.title,
        body: payload.body,
        icon: logoUrl,
        badge: logoUrl,
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
