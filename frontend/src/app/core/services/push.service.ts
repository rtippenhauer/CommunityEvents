import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { SwPush } from '@angular/service-worker';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private readonly http = inject(HttpClient);
  private readonly swPush = inject(SwPush);

  get isSupported(): boolean {
    return this.swPush.isEnabled && !!environment.vapidPublicKey;
  }

  readonly subscription$ = this.swPush.subscription;

  async requestSubscription(): Promise<void> {
    if (!this.swPush.isEnabled || !environment.vapidPublicKey) return;
    try {
      const sub = await this.swPush.requestSubscription({ serverPublicKey: environment.vapidPublicKey });
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await this.http.post('/api/v1/notifications/push/subscribe', {
        endpoint: json.endpoint,
        keys: json.keys,
      }).toPromise();
    } catch {
      // User denied or SW not ready — silently ignore
    }
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
