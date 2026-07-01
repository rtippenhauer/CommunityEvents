import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PushNotificationService } from '../../core/services/push.service';

interface NotifPrefs {
  emailInvite: boolean; emailSecurityAlert: boolean; emailEventPublished: boolean;
  emailRsvpConfirmation: boolean; emailEventReminder: boolean;
  emailAccountDeletion: boolean; emailReengagement: boolean;
  pushEventPublished: boolean; pushEventReminder: boolean; pushAnnouncement: boolean;
}

@Component({
  selector: 'app-profile-notifications',
  standalone: true,
  imports: [
    MatCardModule,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="notif-container">
      <h1 class="page-title">Notifications</h1>

      <mat-card>
        <mat-card-content>
          @if (emailStatus() === 'unsubscribed') {
            <div class="email-status-banner unsubscribed-banner">
              <mat-icon>unsubscribe</mat-icon>
              <span>You are currently unsubscribed from all DinnerBears emails.</span>
              <button mat-stroked-button color="primary" (click)="resubscribe()">Resubscribe</button>
            </div>
          } @else if (emailStatus() === 'complained') {
            <div class="email-status-banner complained-banner">
              <mat-icon>report</mat-icon>
              <span>Your email was marked as spam. Please contact us to restore email delivery.</span>
            </div>
          }

          @if (notifPrefs(); as prefs) {
            <div class="notif-section">
              <h3 class="notif-section-title">Email Notifications</h3>
              <div class="notif-row">
                <span class="notif-label">Invites sent to you</span>
                <mat-slide-toggle [checked]="prefs.emailInvite" (change)="togglePref('emailInvite', $event.checked)" [disabled]="savingPrefs()" />
              </div>
              <div class="notif-row">
                <span class="notif-label">Security alerts</span>
                <mat-slide-toggle [checked]="prefs.emailSecurityAlert" (change)="togglePref('emailSecurityAlert', $event.checked)" [disabled]="savingPrefs()" />
              </div>
              <div class="notif-row">
                <span class="notif-label">New events published</span>
                <mat-slide-toggle [checked]="prefs.emailEventPublished" (change)="togglePref('emailEventPublished', $event.checked)" [disabled]="savingPrefs()" />
              </div>
              <div class="notif-row">
                <span class="notif-label">RSVP confirmations</span>
                <mat-slide-toggle [checked]="prefs.emailRsvpConfirmation" (change)="togglePref('emailRsvpConfirmation', $event.checked)" [disabled]="savingPrefs()" />
              </div>
              <div class="notif-row">
                <span class="notif-label">Event reminders</span>
                <mat-slide-toggle [checked]="prefs.emailEventReminder" (change)="togglePref('emailEventReminder', $event.checked)" [disabled]="savingPrefs()" />
              </div>
              <div class="notif-row">
                <span class="notif-label">Account &amp; deletion warnings</span>
                <mat-slide-toggle [checked]="prefs.emailAccountDeletion" (change)="togglePref('emailAccountDeletion', $event.checked)" [disabled]="savingPrefs()" />
              </div>
              <div class="notif-row">
                <span class="notif-label">Re-engagement reminders</span>
                <mat-slide-toggle [checked]="prefs.emailReengagement" (change)="togglePref('emailReengagement', $event.checked)" [disabled]="savingPrefs()" />
              </div>
            </div>

            <mat-divider class="section-divider" />

            <div class="notif-section">
              <h3 class="notif-section-title">Push Notifications</h3>
              @if (pushService.isIosNonStandalone) {
                <div class="push-subscribe-banner ios-hint-banner">
                  <mat-icon>add_to_home_screen</mat-icon>
                  <span>To enable push notifications on iPhone, tap <strong>Share → Add to Home Screen</strong> first, then open the app from your home screen.</span>
                </div>
              } @else if (pushService.isSupported && !pushSubscribed()) {
                <div class="push-subscribe-banner">
                  <mat-icon>notifications_off</mat-icon>
                  <span>Browser notifications are not enabled yet.</span>
                  <button mat-stroked-button color="primary" (click)="enablePush()">Enable</button>
                </div>
              }
              <div class="notif-row">
                <span class="notif-label">New events published</span>
                <mat-slide-toggle [checked]="prefs.pushEventPublished" (change)="togglePref('pushEventPublished', $event.checked)" [disabled]="savingPrefs()" />
              </div>
              <div class="notif-row">
                <span class="notif-label">Event reminders</span>
                <mat-slide-toggle [checked]="prefs.pushEventReminder" (change)="togglePref('pushEventReminder', $event.checked)" [disabled]="savingPrefs()" />
              </div>
              <div class="notif-row">
                <span class="notif-label">Announcements</span>
                <mat-slide-toggle [checked]="prefs.pushAnnouncement" (change)="togglePref('pushAnnouncement', $event.checked)" [disabled]="savingPrefs()" />
              </div>
            </div>

            @if (emailStatus() === 'active') {
              <mat-divider class="section-divider" />
              <div class="unsubscribe-row">
                <span class="unsubscribe-hint">Want to stop all emails at once?</span>
                <button mat-stroked-button color="warn" (click)="unsubscribe()">Unsubscribe All</button>
              </div>
            }
          } @else {
            <mat-spinner diameter="28" />
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .notif-container {
      max-width: 600px;
      margin: 0 auto;
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .page-title {
      font-size: 1.4rem;
      font-weight: 700;
      margin: 0;
      color: #1a1a1a;
    }
    mat-card-content { padding-top: 8px; }
    .email-status-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 8px;
      margin-bottom: 16px;
      font-size: 0.875rem;
      flex-wrap: wrap;
    }
    .unsubscribed-banner { background: #fff3e0; }
    .complained-banner { background: #fce4ec; }
    .ios-hint-banner { background: #e8f4fd; align-items: flex-start; line-height: 1.4; }
    .push-subscribe-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 8px;
      background: #fff8e1;
      font-size: 0.875rem;
      margin-bottom: 12px;
      flex-wrap: wrap;
      mat-icon { color: #f9a825; font-size: 1.1rem; width: 1.1rem; height: 1.1rem; }
      span { flex: 1; }
    }
    .notif-section { padding: 8px 0; }
    .notif-section-title {
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: #888;
      margin: 0 0 10px;
    }
    .notif-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f5f5f5;
    }
    .notif-label { font-size: 0.9rem; }
    .section-divider { margin: 12px 0; }
    .unsubscribe-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0 4px;
      flex-wrap: wrap;
      gap: 8px;
    }
    .unsubscribe-hint { font-size: 0.85rem; color: #888; }
  `],
})
export class ProfileNotificationsComponent implements OnInit {
  readonly pushService = inject(PushNotificationService);
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);

  readonly notifPrefs = signal<NotifPrefs | null>(null);
  readonly savingPrefs = signal(false);
  readonly emailStatus = signal<string | null>(null);
  readonly pushSubscribed = signal(false);

  ngOnInit(): void {
    this.http.get<NotifPrefs>('/api/v1/users/me/notification-prefs').subscribe({
      next: (prefs) => this.notifPrefs.set(prefs),
    });
    this.http.get<{ emailStatus: string }>('/api/v1/users/me').subscribe({
      next: (u) => this.emailStatus.set(u.emailStatus),
    });
    this.pushService.subscription$.subscribe((sub) => this.pushSubscribed.set(!!sub));
  }

  togglePref(key: keyof NotifPrefs, value: boolean): void {
    this.savingPrefs.set(true);
    this.http.patch<NotifPrefs>('/api/v1/users/me/notification-prefs', { [key]: value }).subscribe({
      next: (prefs) => { this.notifPrefs.set(prefs); this.savingPrefs.set(false); },
      error: () => {
        this.snackBar.open('Failed to save preference', 'OK', { duration: 3000 });
        this.savingPrefs.set(false);
        this.http.get<NotifPrefs>('/api/v1/users/me/notification-prefs').subscribe({
          next: (prefs) => this.notifPrefs.set(prefs),
        });
      },
    });
  }

  unsubscribe(): void {
    this.http.post<{ message: string }>('/api/v1/users/me/unsubscribe', {}).subscribe({
      next: (res) => { this.emailStatus.set('unsubscribed'); this.snackBar.open(res.message, 'OK', { duration: 4000 }); },
      error: () => this.snackBar.open('Failed to unsubscribe', 'OK', { duration: 3000 }),
    });
  }

  resubscribe(): void {
    this.http.post<{ message: string }>('/api/v1/users/me/resubscribe', {}).subscribe({
      next: (res) => { this.emailStatus.set('active'); this.snackBar.open(res.message, 'OK', { duration: 4000 }); },
      error: () => this.snackBar.open('Failed to resubscribe', 'OK', { duration: 3000 }),
    });
  }

  async enablePush(): Promise<void> {
    try {
      await this.pushService.requestSubscription();
      this.snackBar.open('Push notifications enabled!', 'OK', { duration: 3000 });
    } catch (err: any) {
      const msg = err?.message === 'PERMISSION_DENIED'
        ? 'Notifications are blocked — open your browser\'s site settings and allow notifications for this site, then try again.'
        : 'Could not enable push notifications. Please try again.';
      this.snackBar.open(msg, 'OK', { duration: 7000 });
    }
  }
}
