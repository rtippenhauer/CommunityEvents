import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { Clipboard } from '@angular/cdk/clipboard';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTabsModule } from '@angular/material/tabs';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/services/auth.service';
import { FeedbackService, MemberFeedbackStats } from '../../core/services/feedback.service';
import { PhotoCropDialogComponent } from '../../shared/components/photo-crop-dialog/photo-crop-dialog.component';
import { environment } from '../../../environments/environment';

interface City {
  id: number;
  name: string;
  subdomain: string;
}

interface MiniMember {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
}

interface MyProfile {
  invitedBy: MiniMember | null;
  invitedMembers: MiniMember[];
}

interface NotifPrefs {
  emailInvite: boolean;
  emailSecurityAlert: boolean;
  emailEventPublished: boolean;
  emailRsvpConfirmation: boolean;
  emailEventReminder: boolean;
  emailAccountDeletion: boolean;
  emailReengagement: boolean;
  pushEventPublished: boolean;
  pushEventReminder: boolean;
  pushAnnouncement: boolean;
}

interface Invite {
  id: number;
  token: string;
  type: string;
  boundToEmail: string | null;
  boundToName: string | null;
  expiresAt: string;
  isRevoked: boolean;
  useCount: number;
  maxUses: number | null;
  redeemedAt: string | null;
  createdAt: string;
}

interface AvatarEntry { path: string; label: string; }

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    DatePipe,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    MatDialogModule,
    MatSlideToggleModule,
    MatTabsModule,
    MatTooltipModule,
  ],
  template: `
    <div class="profile-container">
      <!-- Profile card -->
      <mat-card>
        <mat-card-header>
          <mat-card-title>Your Profile</mat-card-title>
        </mat-card-header>
        <mat-card-content>
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

              <!-- Photo section -->
              <div class="photo-section">
                <div class="photo-current">
                  <div class="photo-preview">
                    @if (photoUrl()) {
                      <img [src]="photoUrl()!" alt="Profile photo" class="profile-photo" />
                    } @else {
                      <img src="/avatars/bear-default.jpg" alt="Bear avatar" class="profile-photo" />
                    }
                  </div>
                  <div class="photo-actions">
                    <button mat-stroked-button type="button" class="change-avatar-btn" (click)="avatarOpen.set(!avatarOpen())">
                      <mat-icon>{{ avatarOpen() ? 'expand_less' : 'edit' }}</mat-icon>
                      {{ avatarOpen() ? 'Close' : 'Change Avatar' }}
                    </button>
                    @if (photoUrl()) {
                      <button mat-button type="button" color="warn" (click)="removePhoto()">Remove</button>
                    }
                  </div>
                </div>

                @if (avatarOpen()) {
                  <mat-tab-group animationDuration="150ms">
                    <mat-tab label="Choose a Bear">
                      <div class="avatar-tab-actions">
                        <button mat-stroked-button type="button" class="lucky-btn" (click)="feelLucky()">
                          <mat-icon>casino</mat-icon> I Feel Lucky
                        </button>
                      </div>
                      <div class="avatar-grid">
                        @for (avatar of presetAvatars(); track avatar.path) {
                          <button
                            type="button"
                            class="avatar-tile"
                            [class.selected]="photoUrl() === avatar.path"
                            [matTooltip]="avatar.label"
                            (click)="selectAvatar(avatar.path)"
                          >
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

                <input
                  #fileInput
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style="display:none"
                  (change)="onFileSelected($event)"
                />
              </div>

              <mat-card-actions>
                <button
                  mat-raised-button
                  color="primary"
                  type="submit"
                  [disabled]="form.invalid || saving()"
                >
                  Save Changes
                </button>
              </mat-card-actions>
            </form>
          }
        </mat-card-content>
      </mat-card>

      <!-- Invited by / brought in -->
      @if (myProfile()?.invitedBy || (myProfile()?.invitedMembers?.length ?? 0) > 0) {
        <mat-card class="connections-card">
          <mat-card-content>
            @if (myProfile()?.invitedBy; as inviter) {
              <div class="connection-row">
                <span class="connection-label">Invited by</span>
                <a class="mini-member" [routerLink]="['/members', inviter.id]">
                  <div class="mini-avatar">
                    @if (inviter.profilePhotoPath) {
                      <img [src]="inviter.profilePhotoPath" [alt]="inviter.fullName" />
                    } @else {
                      <img src="/avatars/bear-default.jpg" [alt]="inviter.fullName" />
                    }
                  </div>
                  <span>{{ inviter.fullName }}</span>
                </a>
              </div>
            }
            @if ((myProfile()?.invitedMembers?.length ?? 0) > 0) {
              <div class="connection-row">
                <span class="connection-label">Brought to the table</span>
                <div class="mini-members-list">
                  @for (m of myProfile()!.invitedMembers; track m.id) {
                    <a class="mini-member" [routerLink]="['/members', m.id]">
                      <div class="mini-avatar">
                        @if (m.profilePhotoPath) {
                          <img [src]="m.profilePhotoPath" [alt]="m.fullName" />
                        } @else {
                          <img src="/avatars/bear-default.jpg" [alt]="m.fullName" />
                        }
                      </div>
                      <span>{{ m.fullName }}</span>
                    </a>
                  }
                </div>
              </div>
            }
          </mat-card-content>
        </mat-card>
      }

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

      <!-- Invite shortcut -->
      <mat-card class="invite-shortcut-card">
        <mat-card-content>
          <div class="invite-shortcut">
            <mat-icon class="invite-shortcut-icon">group_add</mat-icon>
            <div class="invite-shortcut-text">
              <span class="invite-shortcut-title">Invite a Friend</span>
              <span class="invite-shortcut-sub">Send a personal invite link to join DinnerBears</span>
            </div>
            <a mat-raised-button color="primary" routerLink="/invite">
              <mat-icon>add_link</mat-icon> Invite
            </a>
          </div>
        </mat-card-content>
      </mat-card>

      <!-- Connected accounts (only when Facebook is enabled for this build) -->
      @if (facebookEnabled) {
        <mat-card class="connected-accounts-card">
          <mat-card-header>
            <mat-card-title>Connected Accounts</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="account-row">
              <svg class="provider-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
              <span class="account-name">Facebook</span>
              @if (fbLinked()) {
                <span class="account-status linked"><mat-icon>check_circle</mat-icon> Connected</span>
              } @else {
                <button mat-stroked-button class="connect-fb-btn" (click)="connectFacebook()" [disabled]="fbLinking() || !fbReady()">
                  @if (fbLinking()) { <mat-spinner diameter="16" /> }
                  @else { Connect }
                </button>
              }
            </div>
          </mat-card-content>
        </mat-card>
      }

      <!-- Feedback stats card -->
      @if (feedbackStats()) {
        <mat-card class="stats-card">
          <mat-card-header>
            <mat-card-title>Your Contributions</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="stats-row">
              <a class="stat-item" routerLink="/feedback">
                <span class="stat-value">{{ feedbackStats()!.bugsReported }}</span>
                <span class="stat-label">Bugs Reported</span>
              </a>
              <a class="stat-item" routerLink="/feedback">
                <span class="stat-value">{{ feedbackStats()!.featuresRequested }}</span>
                <span class="stat-label">Features Requested</span>
              </a>
              <a class="stat-item shipped" routerLink="/updates">
                <span class="stat-value">{{ feedbackStats()!.shippedCount }}</span>
                <span class="stat-label">Ideas Shipped</span>
              </a>
            </div>
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
  styles: [
    `
      .profile-container {
        max-width: 600px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 24px;
      }
      .profile-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px 0;
      }
      .photo-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .photo-current {
        display: flex;
        align-items: center;
        gap: 16px;
      }
      .photo-actions {
        display: flex;
        flex-direction: column;
        gap: 6px;
        align-items: flex-start;
      }
      .change-avatar-btn {
        font-size: 0.82rem !important;
      }
      .photo-preview {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        overflow: hidden;
        flex-shrink: 0;
        border: 2px solid #ddd;
      }
      .profile-photo {
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center top;
        display: block;
      }
      .photo-placeholder {
        width: 100%;
        height: 100%;
        background: #f0f0f0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
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
        transition:
          border-color 0.15s,
          transform 0.15s;

        img {
          width: 100%;
          aspect-ratio: 1;
          object-fit: cover;
          object-position: center top;
          display: block;
        }

        &:hover {
          border-color: var(--db-primary, #1e4d8c);
          transform: scale(1.04);
        }

        &.selected {
          border-color: var(--db-primary, #1e4d8c);
          box-shadow: 0 0 0 2px var(--db-primary, #1e4d8c);
        }
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
      .photo-hint {
        font-size: 0.75rem;
        color: #999;
        margin: 0;
      }

      /* Connections card */
      .connections-card mat-card-content {
        padding: 12px 16px;
      }
      .connection-row {
        display: flex;
        flex-direction: column;
        gap: 8px;
        & + .connection-row {
          margin-top: 16px;
        }
      }
      .connection-label {
        font-size: 0.75rem;
        font-weight: 600;
        color: #999;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .mini-members-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .mini-member {
        display: flex;
        align-items: center;
        gap: 8px;
        text-decoration: none;
        color: inherit;
        padding: 6px 10px;
        border-radius: 8px;
        background: #f5f5f5;
        font-size: 0.88rem;
        transition: background 0.12s;
        &:hover {
          background: #ebebeb;
        }
      }
      .mini-avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        overflow: hidden;
        background: #e0e0e0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.9rem;
        flex-shrink: 0;
        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      }

      /* Collapsible header */
      .collapsible-header {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 16px 16px 20px;
        background: none;
        border: none;
        cursor: pointer;
        text-align: left;
        border-bottom: 1px solid transparent;
        transition: background 0.12s;
        &:hover { background: #faf7f2; }
      }
      .collapsible-header-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .collapsible-title {
        font-size: 1rem;
        font-weight: 600;
        color: var(--db-brown-dark, #3d1c05);
      }
      .collapsible-sub {
        font-size: 0.78rem;
        color: #999;
      }
      .collapsible-chevron {
        color: #aaa;
        flex-shrink: 0;
      }

      /* Invite shortcut card */
      .invite-shortcut {
        display: flex;
        align-items: center;
        gap: 14px;
        .invite-shortcut-icon { font-size: 2rem; width: 2rem; height: 2rem; color: var(--db-blue, #1E4D8C); flex-shrink: 0; }
        .invite-shortcut-text { flex: 1; }
        .invite-shortcut-title { display: block; font-size: 0.95rem; font-weight: 600; color: #222; }
        .invite-shortcut-sub { display: block; font-size: 0.8rem; color: #888; margin-top: 2px; }
      }

      /* Notifications card */
      .notif-card mat-card-content {
        padding-top: 8px;
      }
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
      .unsubscribed-banner {
        background: #fff3e0;
      }
      .complained-banner {
        background: #fce4ec;
      }
      .notif-section {
        padding: 8px 0;
      }
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
      .notif-label {
        font-size: 0.9rem;
      }
      .unsubscribe-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 0 4px;
        flex-wrap: wrap;
        gap: 8px;
      }
      .unsubscribe-hint {
        font-size: 0.85rem;
        color: #888;
      }
      .stats-card mat-card-content { padding-top: 8px; }
      .stats-row {
        display: flex;
        gap: 16px;
        flex-wrap: wrap;
      }
      .stat-item {
        flex: 1;
        min-width: 90px;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 16px 8px;
        border-radius: 10px;
        background: #f5f5f5;
        text-decoration: none;
        color: inherit;
        transition: background 0.15s;
        &:hover { background: #e8f4fd; }
        &.shipped { background: #e8f5e9; &:hover { background: #c8e6c9; } }
      }
      .stat-value { font-size: 1.75rem; font-weight: 800; color: var(--db-blue, #1E4D8C); line-height: 1; margin-bottom: 4px; }
      .stat-item.shipped .stat-value { color: #2e7d32; }
      .stat-label { font-size: 0.75rem; color: #888; text-align: center; }

      /* Connected accounts */
      .connected-accounts-card mat-card-content { padding-top: 8px; }
      .account-row {
        display: flex; align-items: center; gap: 12px; padding: 8px 0;
      }
      .provider-icon { width: 24px; height: 24px; flex-shrink: 0; }
      .account-name { flex: 1; font-size: 0.95rem; font-weight: 500; }
      .account-status.linked {
        display: flex; align-items: center; gap: 4px;
        font-size: 0.85rem; color: #2e7d32;
        mat-icon { font-size: 1rem; width: 1rem; height: 1rem; }
      }
      .connect-fb-btn { height: 32px; font-size: 0.85rem; min-width: 90px; }
    `,
  ],
})
export class ProfileComponent implements OnInit {
  readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly clipboard = inject(Clipboard);
  private readonly feedbackService = inject(FeedbackService);

  readonly presetAvatars = signal<AvatarEntry[]>([]);
  readonly cities = signal<City[]>([]);
  readonly saving = signal(false);
  readonly photoUrl = signal<string | null>(null);
  readonly avatarOpen = signal(false);
  readonly invitesOpen = signal(false);
  readonly revokingId = signal<number | null>(null);

  readonly form = this.fb.group({
    fullName: ['', [Validators.required, Validators.maxLength(200)]],
    cityId: [0, Validators.required],
  });

  readonly myProfile = signal<MyProfile | null>(null);
  readonly myInvites = signal<Invite[]>([]);
  readonly newInviteUrl = signal<string | null>(null);
  readonly creatingInvite = signal(false);
  readonly notifPrefs = signal<NotifPrefs | null>(null);
  readonly savingPrefs = signal(false);
  readonly emailStatus = signal<string | null>(null);
  readonly feedbackStats = signal<MemberFeedbackStats | null>(null);
  readonly fbReady = signal(false);
  readonly fbLinked = signal(false);
  readonly fbLinking = signal(false);
  readonly facebookEnabled = !!environment.facebookAppId;

  readonly inviteForm = this.fb.group({
    boundToEmail: ['', [Validators.required, Validators.email]],
    boundToName: [''],
  });

  ngOnInit(): void {
    this.http.get<City[]>('/api/v1/cities').subscribe((cities) => {
      this.cities.set(cities);
    });
    this.http.get<AvatarEntry[]>('/avatars/manifest.json').subscribe({
      next: (avatars) => this.presetAvatars.set(avatars),
      error: () => {},
    });
    const user = this.authService.currentUser();
    if (user) {
      this.form.patchValue({ fullName: user.fullName, cityId: user.cityId });
      const path = user.profilePhotoPath;
      this.photoUrl.set(path ?? null);
    }
    this.loadMyInvites();
    this.loadMyProfile();
    this.loadNotifPrefs();
    this.feedbackService.getMyStats().subscribe({
      next: (stats) => this.feedbackStats.set(stats),
      error: () => {},
    });
    this.http.get<{ emailStatus: string }>('/api/v1/users/me').subscribe({
      next: (u) => this.emailStatus.set(u.emailStatus),
    });

    if (environment.facebookAppId) {
      this.loadFbSdk(environment.facebookAppId);
    }
  }

  private loadFbSdk(appId: string): void {
    const win = window as any;

    console.log('[FB] loadFbSdk', { fbExists: !!win.FB, fbDone: win.__fbDone });

    if (win.__fbDone) {
      console.log('[FB] already done, setting ready');
      this.fbReady.set(true);
      return;
    }

    const onReady = () => {
      console.log('[FB] onReady', { fbExists: !!win.FB, fbDone: win.__fbDone });
      if (!win.__fbDone) {
        console.log('[FB] calling FB.init()');
        win.FB.init({ appId, cookie: true, xfbml: false, version: 'v22.0' });
        win.__fbDone = true;
        console.log('[FB] FB.init() completed, __fbDone=true');
      }
      this.fbReady.set(true);
    };

    if (win.FB) {
      console.log('[FB] FB already exists, calling onReady directly');
      onReady();
      return;
    }

    console.log('[FB] setting fbAsyncInit and adding script');
    win.fbAsyncInit = onReady;

    if (!document.getElementById('facebook-jssdk')) {
      const js = document.createElement('script');
      js.id = 'facebook-jssdk';
      js.src = 'https://connect.facebook.net/en_US/sdk.js';
      document.head.appendChild(js);
    }
  }

  connectFacebook(): void {
    const win = window as any;
    console.log('[FB] connectFacebook', { fbExists: !!win.FB, fbDone: win.__fbDone, fbReady: this.fbReady() });
    if (!win.FB || !win.__fbDone) {
      console.log('[FB] not ready, re-loading SDK');
      this.fbReady.set(false);
      this.loadFbSdk(environment.facebookAppId!);
      return;
    }
    this.fbLinking.set(true);
    console.log('[FB] calling FB.login()');
    win.FB.login((response: any) => {
      if (response.status !== 'connected') {
        this.fbLinking.set(false);
        return;
      }
      this.authService.linkFacebook(response.authResponse.accessToken).subscribe({
        next: () => {
          this.fbLinking.set(false);
          this.fbLinked.set(true);
          this.snackBar.open('Facebook account connected!', 'OK', { duration: 3000 });
        },
        error: (err) => {
          this.fbLinking.set(false);
          const msg = err?.error?.message ?? 'Failed to connect Facebook account.';
          this.snackBar.open(msg, 'OK', { duration: 5000 });
        },
      });
    }, { scope: 'public_profile,email' });
  }

  loadNotifPrefs(): void {
    this.http.get<NotifPrefs>('/api/v1/users/me/notification-prefs').subscribe({
      next: (prefs) => this.notifPrefs.set(prefs),
    });
  }

  togglePref(key: keyof NotifPrefs, value: boolean): void {
    this.savingPrefs.set(true);
    this.http.patch<NotifPrefs>('/api/v1/users/me/notification-prefs', { [key]: value }).subscribe({
      next: (prefs) => {
        this.notifPrefs.set(prefs);
        this.savingPrefs.set(false);
      },
      error: () => {
        this.snackBar.open('Failed to save preference', 'OK', { duration: 3000 });
        this.savingPrefs.set(false);
        this.loadNotifPrefs();
      },
    });
  }

  unsubscribe(): void {
    this.http.post<{ message: string }>('/api/v1/users/me/unsubscribe', {}).subscribe({
      next: (res) => {
        this.emailStatus.set('unsubscribed');
        this.snackBar.open(res.message, 'OK', { duration: 4000 });
      },
      error: () => this.snackBar.open('Failed to unsubscribe', 'OK', { duration: 3000 }),
    });
  }

  resubscribe(): void {
    this.http.post<{ message: string }>('/api/v1/users/me/resubscribe', {}).subscribe({
      next: (res) => {
        this.emailStatus.set('active');
        this.snackBar.open(res.message, 'OK', { duration: 4000 });
      },
      error: () => this.snackBar.open('Failed to resubscribe', 'OK', { duration: 3000 }),
    });
  }

  loadMyProfile(): void {
    const user = this.authService.currentUser();
    if (!user) return;
    this.http.get<MyProfile>(`/api/v1/users/${user.id}`).subscribe({
      next: (p) => this.myProfile.set(p),
    });
  }

  loadMyInvites(): void {
    this.http.get<Invite[]>('/api/v1/invites/mine').subscribe({
      next: (invites) => this.myInvites.set(invites),
    });
  }

  createInvite(): void {
    if (this.inviteForm.invalid) return;
    this.creatingInvite.set(true);
    const { boundToEmail, boundToName } = this.inviteForm.getRawValue();
    const body: Record<string, unknown> = { type: 'member', boundToEmail };
    if (boundToName) body['boundToName'] = boundToName;

    this.http.post<Invite>('/api/v1/invites', body).subscribe({
      next: (invite) => {
        this.newInviteUrl.set(`${window.location.origin}/login?token=${invite.token}`);
        this.inviteForm.reset();
        this.loadMyInvites();
        this.creatingInvite.set(false);
      },
      error: (err) => {
        const msg = err?.error?.message ?? 'Failed to create invite';
        this.snackBar.open(msg, 'OK', { duration: 4000 });
        this.creatingInvite.set(false);
      },
    });
  }

  copyNewLink(): void {
    const url = this.newInviteUrl();
    if (url) {
      this.clipboard.copy(url);
      this.snackBar.open('Link copied', 'OK', { duration: 2000 });
    }
  }

  copyToken(token: string): void {
    const url = `${window.location.origin}/login?token=${token}`;
    this.clipboard.copy(url);
    this.snackBar.open('Link copied', 'OK', { duration: 2000 });
  }

  isExpired(invite: Invite): boolean {
    return new Date(invite.expiresAt) < new Date();
  }

  revokeInvite(id: number): void {
    this.revokingId.set(id);
    this.http.patch(`/api/v1/invites/${id}/revoke-own`, {}).subscribe({
      next: () => {
        this.revokingId.set(null);
        this.loadMyInvites();
        this.snackBar.open('Invite revoked', 'OK', { duration: 2000 });
      },
      error: (err) => {
        this.revokingId.set(null);
        this.snackBar.open(err?.error?.message ?? 'Failed to revoke invite', 'OK', { duration: 3000 });
      },
    });
  }

  openFilePicker(): void {
    document.querySelector<HTMLInputElement>('input[type="file"]')?.click();
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
      if (!blob) return;
      this.uploadBlob(blob);
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
    const pick = avatars[Math.floor(Math.random() * avatars.length)];
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
}
