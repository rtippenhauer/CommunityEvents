import { Component, inject, OnInit, signal, ViewChild, ElementRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/services/auth.service';
import { PushNotificationService } from '../../core/services/push.service';
import { PhotoCropDialogComponent } from '../../shared/components/photo-crop-dialog/photo-crop-dialog.component';

interface City { id: number; name: string; subdomain: string; }
interface NotifPrefs {
  emailInvite: boolean; emailSecurityAlert: boolean; emailEventPublished: boolean;
  emailRsvpConfirmation: boolean; emailEventReminder: boolean;
  emailAccountDeletion: boolean; emailReengagement: boolean;
  pushEventPublished: boolean; pushEventReminder: boolean; pushAnnouncement: boolean;
}
interface AvatarEntry { path: string; label: string; }

@Component({
  selector: 'app-profile-settings',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatSlideToggleModule,
    MatTabsModule,
    MatTooltipModule,
  ],
  template: `
    <div class="settings-container">
      <h1 class="page-title">Settings</h1>

      <!-- Avatar + Edit form card -->
      <mat-card>
        <mat-card-header>
          <mat-card-title>Profile</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <!-- Photo section -->
          <div class="photo-section">
            <div class="photo-wrapper">
              <div class="photo-preview">
                @if (photoUrl()) {
                  <img [src]="photoUrl()!" alt="Profile photo" class="profile-photo" />
                } @else {
                  <img src="/avatars/bear-default.jpg" alt="Bear avatar" class="profile-photo" />
                }
              </div>
            </div>
            <button mat-button type="button" class="change-photo-btn" (click)="avatarOpen.set(!avatarOpen())">
              <mat-icon>{{ avatarOpen() ? 'close' : 'photo_camera' }}</mat-icon>
              {{ avatarOpen() ? 'Close' : 'Change photo' }}
            </button>
            @if (photoUrl()) {
              <button mat-button type="button" color="warn" class="remove-photo-btn" (click)="removePhoto()">
                Remove photo
              </button>
            }
            @if (avatarOpen()) {
              <mat-tab-group animationDuration="150ms" class="avatar-picker">
                <mat-tab label="Choose a Bear">
                  <div class="avatar-tab-actions">
                    <button mat-stroked-button type="button" class="lucky-btn" (click)="feelLucky()">
                      <mat-icon>casino</mat-icon> I Feel Lucky
                    </button>
                  </div>
                  <div class="avatar-grid">
                    @for (avatar of presetAvatars(); track avatar.path) {
                      <button type="button" class="avatar-tile"
                        [class.selected]="photoUrl() === avatar.path"
                        [matTooltip]="avatar.label"
                        (click)="selectAvatar(avatar.path)">
                        <img [src]="avatar.path" [alt]="avatar.label" />
                        @if (photoUrl() === avatar.path) {
                          <div class="avatar-check">✓</div>
                        }
                      </button>
                    }
                  </div>
                </mat-tab>
                <mat-tab label="Upload Photo">
                  <div class="upload-tab">
                    <button mat-stroked-button type="button" (click)="openFilePicker()">
                      Choose photo…
                    </button>
                    <p class="photo-hint">Square images work best. Max 5 MB. JPEG, PNG, or WebP.</p>
                  </div>
                </mat-tab>
              </mat-tab-group>
            }
            <input #fileInput type="file" accept="image/jpeg,image/png,image/webp"
              style="display:none" (change)="onFileSelected($event)" />
          </div>

          @if (saving()) {
            <mat-spinner diameter="32" />
          } @else {
            <form [formGroup]="form" (ngSubmit)="save()" class="profile-form">
              <mat-form-field appearance="outline">
                <mat-label>Full Name</mat-label>
                <input matInput formControlName="fullName" />
                <mat-error>Name is required</mat-error>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>City</mat-label>
                <mat-select formControlName="cityId">
                  @for (city of cities(); track city.id) {
                    <mat-option [value]="city.id">{{ city.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Email</mat-label>
                <input matInput [value]="authService.currentUser()?.email" readonly />
              </mat-form-field>
              <mat-card-actions>
                <button mat-raised-button color="primary" type="submit"
                  [disabled]="form.invalid || saving()">
                  Save Changes
                </button>
              </mat-card-actions>
            </form>
          }
        </mat-card-content>
      </mat-card>

      <!-- Notifications card -->
      <mat-card class="notif-card">
        <mat-card-header>
          <mat-card-title>Email &amp; Notification Settings</mat-card-title>
        </mat-card-header>
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
              @if (pushService.isSupported && !pushSubscribed()) {
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
    .settings-container {
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
    .photo-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 16px 0 8px;
    }
    .photo-wrapper {
      position: relative;
      width: 96px;
      height: 96px;
    }
    .photo-edit-btn {
      position: absolute;
      bottom: -4px;
      right: -4px;
      width: 32px !important;
      height: 32px !important;
      min-height: 32px !important;
      box-shadow: 0 1px 4px rgba(0,0,0,0.25);
      mat-icon { font-size: 16px; width: 16px; height: 16px; line-height: 16px; }
    }
    .change-photo-btn { font-size: 0.82rem !important; }
    .remove-photo-btn { font-size: 0.78rem !important; margin-top: -4px; }
    .avatar-picker { width: 100%; margin-top: 4px; }
    .photo-preview {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      overflow: hidden;
      border: 2px solid #ddd;
    }
    .profile-photo {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center top;
      display: block;
    }
    .profile-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 8px 0;
    }
    .avatar-tab-actions {
      display: flex;
      justify-content: flex-end;
      padding: 10px 0 4px;
    }
    .lucky-btn { font-size: 0.82rem !important; }
    .avatar-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      padding: 12px 0;
    }
    .avatar-tile {
      position: relative;
      border: 2px solid transparent;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      padding: 0;
      background: none;
      transition: border-color 0.15s, transform 0.15s;
      img { width: 100%; aspect-ratio: 1; object-fit: cover; object-position: center top; display: block; }
      &:hover { border-color: var(--db-primary, #1e4d8c); transform: scale(1.04); }
      &.selected { border-color: var(--db-primary, #1e4d8c); box-shadow: 0 0 0 2px var(--db-primary, #1e4d8c); }
    }
    .avatar-check {
      position: absolute;
      inset: 0;
      background: rgba(30, 77, 140, 0.45);
      color: #fff;
      font-size: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
    }
    .upload-tab {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      padding: 12px 0;
    }
    .photo-hint { font-size: 0.75rem; color: #999; margin: 0; }
    .notif-card mat-card-content { padding-top: 8px; }
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
export class ProfileSettingsComponent implements OnInit {
  readonly authService = inject(AuthService);
  readonly pushService = inject(PushNotificationService);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  readonly presetAvatars = signal<AvatarEntry[]>([]);
  readonly cities = signal<City[]>([]);
  readonly saving = signal(false);
  readonly photoUrl = signal<string | null>(null);
  readonly avatarOpen = signal(false);
  readonly notifPrefs = signal<NotifPrefs | null>(null);
  readonly savingPrefs = signal(false);
  readonly emailStatus = signal<string | null>(null);
  readonly pushSubscribed = signal(false);

  readonly form = this.fb.group({
    fullName: ['', [Validators.required, Validators.maxLength(200)]],
    cityId: [0, Validators.required],
  });

  ngOnInit(): void {
    this.http.get<City[]>('/api/v1/cities').subscribe((cities) => this.cities.set(cities));
    this.http.get<AvatarEntry[]>('/avatars/manifest.json').subscribe({
      next: (avatars) => this.presetAvatars.set(avatars),
      error: () => {},
    });
    const user = this.authService.currentUser();
    if (user) {
      this.form.patchValue({ fullName: user.fullName, cityId: user.cityId });
      this.photoUrl.set(user.profilePhotoPath ?? null);
    }
    this.loadNotifPrefs();
    this.pushService.subscription$.subscribe((sub) => this.pushSubscribed.set(!!sub));
    this.http.get<{ emailStatus: string }>('/api/v1/users/me').subscribe({
      next: (u) => this.emailStatus.set(u.emailStatus),
    });
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.http.patch('/api/v1/users/me', this.form.getRawValue()).subscribe({
      next: () => {
        this.snackBar.open('Profile updated', 'OK', { duration: 3000 });
        this.saving.set(false);
      },
      error: () => {
        this.snackBar.open('Failed to save', 'OK', { duration: 3000 });
        this.saving.set(false);
      },
    });
  }

  loadNotifPrefs(): void {
    this.http.get<NotifPrefs>('/api/v1/users/me/notification-prefs').subscribe({
      next: (prefs) => this.notifPrefs.set(prefs),
    });
  }

  togglePref(key: keyof NotifPrefs, value: boolean): void {
    this.savingPrefs.set(true);
    this.http.patch<NotifPrefs>('/api/v1/users/me/notification-prefs', { [key]: value }).subscribe({
      next: (prefs) => { this.notifPrefs.set(prefs); this.savingPrefs.set(false); },
      error: () => {
        this.snackBar.open('Failed to save preference', 'OK', { duration: 3000 });
        this.savingPrefs.set(false);
        this.loadNotifPrefs();
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

  openFilePicker(): void {
    this.fileInput.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const ref = this.dialog.open(PhotoCropDialogComponent, {
      data: { file },
      disableClose: true,
      maxWidth: '95vw',
    });
    ref.afterClosed().subscribe((blob: Blob | null) => {
      if (blob) this.uploadBlob(blob);
    });
  }

  private uploadBlob(blob: Blob): void {
    const formData = new FormData();
    formData.append('photo', blob, 'profile.jpg');
    this.http.post<{ url: string }>('/api/v1/users/me/photo', formData).subscribe({
      next: (res) => {
        this.photoUrl.set(res.url);
        this.authService.updatePhoto(res.url);
        this.snackBar.open('Photo updated', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Photo upload failed', 'OK', { duration: 3000 }),
    });
  }

  feelLucky(): void {
    const avatars = this.presetAvatars();
    if (!avatars.length) return;
    const others = avatars.filter((a) => a.path !== this.photoUrl());
    const pick = others.length ? others[Math.floor(Math.random() * others.length)] : avatars[0];
    this.selectAvatar(pick.path);
  }

  selectAvatar(path: string): void {
    this.http.post<{ url: string }>('/api/v1/users/me/avatar', { avatarPath: path }).subscribe({
      next: (res) => {
        this.photoUrl.set(res.url);
        this.authService.updatePhoto(res.url);
        this.snackBar.open('Avatar updated', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Failed to set avatar', 'OK', { duration: 3000 }),
    });
  }

  removePhoto(): void {
    this.http.patch('/api/v1/users/me', { profilePhotoPath: null }).subscribe({
      next: () => {
        this.photoUrl.set(null);
        this.authService.updatePhoto(null);
        this.snackBar.open('Photo removed', 'OK', { duration: 3000 });
      },
    });
  }
}
