import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SwPush } from '@angular/service-worker';
import { BrandConfigService } from './brand-config.service';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private readonly http = inject(HttpClient);
  private readonly swPush = inject(SwPush);
  private readonly brand = inject(BrandConfigService);

  private get isIos(): boolean {
    return typeof navigator !== 'undefined' &&
      /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  /** True when running as an iOS home-screen PWA (standalone mode). */
  get isIosStandalone(): boolean {
    return this.isIos && (navigator as any).standalone === true;
  }

  /** True on iOS Safari (not yet added to home screen). */
  get isIosNonStandalone(): boolean {
    return this.isIos && !(navigator as any).standalone;
  }

  get isSupported(): boolean {
    if (!this.brand.vapidPublicKey()) return false;
    // On iOS, Web Push only works in standalone (home-screen) mode, iOS 16.4+
    if (this.isIos) return this.isIosStandalone && this.swPush.isEnabled;
    return this.swPush.isEnabled;
  }

  readonly subscription$ = this.swPush.subscription;

  async requestSubscription(): Promise<void> {
    const vapidPublicKey = this.brand.vapidPublicKey();
    if (!this.swPush.isEnabled || !vapidPublicKey) return;
    if (Notification.permission === 'denied') {
      throw new Error('PERMISSION_DENIED');
    }
    const sub = await this.swPush.requestSubscription({ serverPublicKey: vapidPublicKey });
    const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
    await this.http.post('/api/v1/notifications/push/subscribe', {
      endpoint: json.endpoint,
      keys: json.keys,
    }).toPromise();
  }

  async unsubscribe(): Promise<void> {
    if (!this.swPush.isEnabled) return;
    try {
      const sub = await this.swPush.requestSubscription({ serverPublicKey: '' }).catch(() => null);
      if (!sub) return;
      const json = sub.toJSON() as { endpoint: string };
      await sub.unsubscribe();
      await this.http.delete('/api/v1/notifications/push/subscribe', {
        body: { endpoint: json.endpoint },
      }).toPromise();
    } catch {
      // ignore
    }
  }
}
