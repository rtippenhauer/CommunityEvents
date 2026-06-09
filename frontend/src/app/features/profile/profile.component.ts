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
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/services/auth.service';
import { PhotoCropDialogComponent } from '../../shared/components/photo-crop-dialog/photo-crop-dialog.component';

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

const PRESET_AVATARS = [
  { path: '/avatars/bear-chef.jpg', label: 'Chef' },
  { path: '/avatars/bear-flannel.jpg', label: 'Flannel' },
  { path: '/avatars/bear-cool.jpg', label: 'Cool' },
  { path: '/avatars/bear-rainbow.jpg', label: 'Rainbow' },
  { path: '/avatars/bear-hoodie.jpg', label: 'Hoodie' },
  { path: '/avatars/bear-bookworm.jpg', label: 'Bookworm' },
  { path: '/avatars/bear-explorer.jpg', label: 'Explorer' },
  { path: '/avatars/bear-musician.jpg', label: 'Musician' },
  { path: '/avatars/bear-athlete.jpg', label: 'Athlete' },
  { path: '/avatars/bear-dapper.jpg', label: 'Dapper' },
  { path: '/avatars/bear-astronaut.jpg', label: 'Astronaut' },
  { path: '/avatars/bear-artist.jpg', label: 'Artist' },
  { path: '/avatars/bear-disco.jpg', label: 'Disco' },
  { path: '/avatars/bear-karaoke.jpg', label: 'Karaoke' },
  { path: '/avatars/bear-pirate.jpg', label: 'Pirate' },
  { path: '/avatars/bear-steampunk.jpg', label: 'Steampunk' },
  { path: '/avatars/bear-viking.jpg', label: 'Viking' },
  { path: '/avatars/bear-wizard.jpg', label: 'Wizard' },
  { path: '/avatars/bear-shopping.png', label: 'Shopping' },
  { path: '/avatars/bear-hawaiian.png', label: 'Hawaiian' },
  { path: '/avatars/bear-nascar.png', label: 'Nascar' },
  { path: '/avatars/bear-bbq.png', label: 'BBQ' },
  { path: '/avatars/bear-brewmaster.png', label: 'Brewmaster' },
  { path: '/avatars/bear-camper.png', label: 'Camper' },
];

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
                <span class="photo-label">Profile Photo</span>

                <div class="photo-current">
                  <div class="photo-preview">
                    @if (photoUrl()) {
                      <img [src]="photoUrl()!" alt="Profile photo" class="profile-photo" />
                    } @else {
                      <img
                        src="/avatars/bear-default.jpg"
                        alt="Bear avatar"
                        class="profile-photo"
                      />
                    }
                  </div>
                  @if (photoUrl()) {
                    <button mat-button type="button" color="warn" (click)="removePhoto()">
                      Remove
                    </button>
                  }
                </div>

                <mat-tab-group animationDuration="150ms">
                  <mat-tab label="Choose a Bear">
                    <div class="avatar-grid">
                      @for (avatar of presetAvatars; track avatar.path) {
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
                      <p class="photo-hint">
                        Square images work best. Max 5 MB. JPEG, PNG, or WebP.
                      </p>
                    </div>
                  </mat-tab>
                </mat-tab-group>

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

      <!-- Invites card -->
      <mat-card class="invites-card">
        <mat-card-header>
          <mat-card-title>Invite a Friend</mat-card-title>
          <mat-card-subtitle
            >Send someone a personal invite link to join DinnerBears.</mat-card-subtitle
          >
        </mat-card-header>
        <mat-card-content>
          <form [formGroup]="inviteForm" (ngSubmit)="createInvite()" class="invite-form">
            <mat-form-field appearance="outline">
              <mat-label>Their Email</mat-label>
              <input matInput formControlName="boundToEmail" type="email" />
              <mat-hint>The link will only work for this address</mat-hint>
              <mat-error>A valid email is required</mat-error>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Their Name (optional)</mat-label>
              <input matInput formControlName="boundToName" />
            </mat-form-field>
            <div>
              <button
                mat-raised-button
                color="primary"
                type="submit"
                [disabled]="inviteForm.invalid || creatingInvite()"
              >
                <mat-icon>add_link</mat-icon>
                Generate Invite Link
              </button>
            </div>
          </form>

          @if (newInviteUrl()) {
            <div class="new-link-banner">
              <mat-icon color="primary">check_circle</mat-icon>
              <span class="new-link-url">{{ newInviteUrl() }}</span>
              <button mat-icon-button (click)="copyNewLink()" aria-label="Copy link" title="Copy">
                <mat-icon>content_copy</mat-icon>
              </button>
            </div>
          }

          @if (myInvites().length > 0) {
            <mat-divider class="section-divider" />
            <h3 class="invites-history-title">Your Invites</h3>
            <div class="invite-list">
              @for (invite of myInvites(); track invite.id) {
                <div class="invite-row">
                  <div class="invite-row-info">
                    <span class="invite-email">{{ invite.boundToEmail ?? '—' }}</span>
                    <span class="invite-meta"
                      >Expires {{ invite.expiresAt | date: 'shortDate' }}</span
                    >
                  </div>
                  <div class="invite-row-status">
                    @if (invite.isRevoked) {
                      <mat-chip class="chip-revoked">Revoked</mat-chip>
                    } @else if (invite.redeemedAt) {
                      <mat-chip class="chip-used">Joined!</mat-chip>
                    } @else if (isExpired(invite)) {
                      <mat-chip class="chip-expired">Expired</mat-chip>
                    } @else {
                      <mat-chip class="chip-active">Pending</mat-chip>
                      <button
                        mat-icon-button
                        (click)="copyToken(invite.token)"
                        aria-label="Copy link"
                        title="Copy link"
                      >
                        <mat-icon>content_copy</mat-icon>
                      </button>
                    }
                  </div>
                </div>
              }
            </div>
          }
        </mat-card-content>
      </mat-card>
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
      .photo-label {
        font-size: 0.875rem;
        color: #555;
        font-weight: 500;
      }
      .photo-current {
        display: flex;
        align-items: center;
        gap: 16px;
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

      /* Invites card */
      .invites-card mat-card-content {
        padding-top: 8px;
      }
      .invite-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 8px 0 16px;
      }
      .new-link-banner {
        display: flex;
        align-items: center;
        gap: 10px;
        background: #e8f5e9;
        border-radius: 8px;
        padding: 10px 12px;
        margin-bottom: 8px;
        flex-wrap: wrap;
      }
      .new-link-url {
        font-family: monospace;
        font-size: 0.8rem;
        word-break: break-all;
        flex: 1;
      }
      .section-divider {
        margin: 16px 0 12px;
      }
      .invites-history-title {
        font-size: 0.9rem;
        font-weight: 600;
        margin: 0 0 10px;
        color: #555;
      }
      .invite-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .invite-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 4px;
        border-bottom: 1px solid #f0f0f0;
      }
      .invite-row-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .invite-email {
        font-size: 0.9rem;
        font-weight: 500;
      }
      .invite-meta {
        font-size: 0.75rem;
        color: #999;
      }
      .invite-row-status {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-shrink: 0;
      }
      mat-chip {
        font-size: 0.72rem !important;
        min-height: 22px !important;
      }
      .chip-active {
        background: #c8e6c9 !important;
      }
      .chip-used {
        background: #bbdefb !important;
      }
      .chip-expired {
        background: #e0e0e0 !important;
      }
      .chip-revoked {
        background: #ffccbc !important;
      }
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

  readonly presetAvatars = PRESET_AVATARS;
  readonly cities = signal<City[]>([]);
  readonly saving = signal(false);
  readonly photoUrl = signal<string | null>(null);

  readonly form = this.fb.group({
    fullName: ['', [Validators.required, Validators.maxLength(200)]],
    cityId: [0, Validators.required],
  });

  readonly myProfile = signal<MyProfile | null>(null);
  readonly myInvites = signal<Invite[]>([]);
  readonly newInviteUrl = signal<string | null>(null);
  readonly creatingInvite = signal(false);

  readonly inviteForm = this.fb.group({
    boundToEmail: ['', [Validators.required, Validators.email]],
    boundToName: [''],
  });

  ngOnInit(): void {
    this.http.get<City[]>('/api/v1/cities').subscribe((cities) => {
      this.cities.set(cities);
    });
    const user = this.authService.currentUser();
    if (user) {
      this.form.patchValue({ fullName: user.fullName, cityId: user.cityId });
      const path = user.profilePhotoPath;
      this.photoUrl.set(path ?? null);
    }
    this.loadMyInvites();
    this.loadMyProfile();
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
