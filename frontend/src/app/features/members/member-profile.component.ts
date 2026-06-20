import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/services/auth.service';
import { ConfirmDialogComponent } from '../../shared/components/confirm-dialog/confirm-dialog.component';

interface MiniMember { id: number; fullName: string; profilePhotoPath: string | null; }

interface MemberProfile {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
  cityName: string | null;
  joinedAt: string;
  role?: string;
  status?: string;
  inviteSource?: string | null;
  invitedBy: MiniMember | null;
  invitedMembers?: MiniMember[];
  hasFacebook?: boolean;
  facebookProfileUrl?: string | null;
  googleEmail?: string | null;
}

@Component({
  selector: 'app-member-profile',
  standalone: true,
  imports: [
    RouterLink,
    DatePipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <div class="profile-view-container">
      @if (loading()) {
        <div class="loading"><mat-spinner diameter="40" /></div>
      } @else if (profile()) {
        <mat-card>
          <mat-card-content>
            <div class="profile-header">
              <div class="avatar-wrap">
                @if (profile()!.profilePhotoPath) {
                  <img [src]="profile()!.profilePhotoPath" alt="Profile photo" class="profile-photo"
                    [class.photo-banned]="profile()!.status === 'suspended'" />
                } @else {
                  <img src="/avatars/bear-default.jpg" alt="Bear avatar" class="profile-photo" [class.photo-banned]="profile()!.status === 'suspended'" />
                }
              </div>
              <div class="profile-meta">
                <h2 class="profile-name">{{ profile()!.fullName }}</h2>
                @if (profile()!.cityName) {
                  <span class="profile-city">{{ profile()!.cityName }}</span>
                }
                <span class="profile-joined">Member since {{ profile()!.joinedAt | date:'MMMM yyyy' }}</span>
                <div class="profile-badges">
                  @if (showElevated() && profile()!.role && profile()!.role !== 'member') {
                    <mat-chip [class]="'role-' + profile()!.role">{{ profile()!.role }}</mat-chip>
                  }
                  @if (showElevated() && profile()!.role === 'non_validated') {
                    <mat-chip class="chip-non-validated">Non-Validated</mat-chip>
                  }
                  @if (profile()!.status === 'suspended') {
                    <mat-chip class="chip-banned">Banned</mat-chip>
                  }
                </div>
                @if (showElevated()) {
                  <div class="provider-badges">
                    @if (profile()!.hasFacebook) {
                      @if (profile()!.facebookProfileUrl) {
                        <a [href]="profile()!.facebookProfileUrl!" target="_blank" rel="noopener noreferrer"
                           class="provider-badge badge-fb" title="View Facebook profile">fb</a>
                      } @else {
                        <span class="provider-badge badge-fb" title="Facebook connected">fb</span>
                      }
                    }
                    @if (profile()!.googleEmail) {
                      <a [href]="'mailto:' + profile()!.googleEmail!" class="provider-badge badge-g"
                         title="Email via Google: {{ profile()!.googleEmail }}">G</a>
                    }
                  </div>
                }
              </div>
            </div>

            <!-- Edit own profile link -->
            @if (isSelf()) {
              <div class="edit-row">
                <a mat-stroked-button routerLink="/profile">
                  <mat-icon>edit</mat-icon> Edit My Profile
                </a>
              </div>
            }

            <!-- Invited by / Self-Invited -->
            @if (showElevated() && profile()!.inviteSource === 'non_validated_link') {
              <div class="invited-section">
                <span class="invited-label">Joined via</span>
                <span class="self-invited-badge">
                  <mat-icon class="self-invited-icon">link</mat-icon> Self-Invited via event link
                </span>
              </div>
            } @else if (profile()!.invitedBy) {
              <div class="invited-section">
                <span class="invited-label">Invited by</span>
                <a class="mini-member" [routerLink]="['/members', profile()!.invitedBy!.id]">
                  <div class="mini-avatar">
                    @if (profile()!.invitedBy!.profilePhotoPath) {
                      <img [src]="profile()!.invitedBy!.profilePhotoPath" [alt]="profile()!.invitedBy!.fullName" />
                    } @else {
                      <img src="/avatars/bear-default.jpg" [alt]="profile()!.invitedBy!.fullName" />
                    }
                  </div>
                  <span>{{ profile()!.invitedBy!.fullName }}</span>
                </a>
              </div>
            }

            <!-- Members they invited -->
            @if ((profile()!.invitedMembers?.length ?? 0) > 0) {
              <div class="invited-section">
                <span class="invited-label">Brought to the table</span>
                <div class="mini-members-list">
                  @for (m of profile()!.invitedMembers!; track m.id) {
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

            <!-- Role selector (admin only, not own profile, not other admins) -->
            @if (isAdmin() && !isSelf() && profile()!.role !== 'admin') {
              <div class="role-section">
                <span class="role-section-label">Role</span>
                <mat-select [value]="profile()!.role" (selectionChange)="setRole($event.value)" class="role-select">
                  <mat-option value="member">Member</mat-option>
                  <mat-option value="moderator">Moderator</mat-option>
                </mat-select>
              </div>
            }

            <!-- Validate Member (mod/admin only, non-validated status) -->
            @if (showElevated() && !isSelf() && profile()!.role === 'non_validated') {
              <div class="validate-section">
                <p class="validate-info">
                  <mat-icon class="validate-info-icon">info_outline</mat-icon>
                  This member joined via a self-serve event link. Validate them to grant full membership.
                </p>
                <button mat-raised-button color="primary" (click)="validateMember()" [disabled]="validating()">
                  @if (validating()) { <mat-spinner diameter="18" /> }
                  <mat-icon>verified_user</mat-icon> Validate Member
                </button>
              </div>
            }

            <!-- Ban controls (mod/admin only, not own profile) -->
            @if (showBanControls()) {
              <div class="ban-section">
                @if (profile()!.status === 'active') {
                  <button mat-stroked-button color="warn" (click)="ban()">
                    <mat-icon>block</mat-icon> Ban Member
                  </button>
                  @if (isAdmin()) {
                    <button mat-stroked-button color="warn" (click)="forceBan()" class="force-ban-btn"
                      matTooltip="Removes from member list, kept for audit">
                      <mat-icon>gavel</mat-icon> Forceful Ban
                    </button>
                  }
                } @else if (profile()!.status === 'suspended') {
                  @if (isAdmin()) {
                    <button mat-stroked-button (click)="unban()">
                      <mat-icon>check_circle</mat-icon> Unban Member
                    </button>
                    <button mat-stroked-button color="warn" (click)="forceBan()" class="force-ban-btn"
                      matTooltip="Permanently removes from member list">
                      <mat-icon>gavel</mat-icon> Forceful Ban
                    </button>
                  }
                }
              </div>
            }
          </mat-card-content>
        </mat-card>
      } @else {
        <p>Member not found.</p>
      }
    </div>
  `,
  styles: [`
    .profile-view-container {
      max-width: 600px;
      margin: 0 auto;
      padding: 16px;
    }
    .loading { display: flex; justify-content: center; padding: 48px; }
    .profile-header {
      display: flex;
      gap: 24px;
      align-items: flex-start;
      padding: 8px 0 16px;
    }
    .avatar-wrap { flex-shrink: 0; }
    .profile-photo, .photo-placeholder {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      object-fit: cover;
      border: 3px solid #eee;
    }
    .photo-placeholder {
      background: #f0f0f0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
    }
    .photo-banned { opacity: 0.5; filter: grayscale(1); }
    .profile-meta {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .profile-name { margin: 0; font-size: 1.4rem; }
    .profile-city { color: #777; font-size: 0.9rem; }
    .profile-joined { color: #aaa; font-size: 0.8rem; }
    .profile-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }
    .provider-badges { display: flex; gap: 4px; margin-top: 4px; }
    .provider-badge {
      font-size: 0.65rem;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 3px;
      text-decoration: none;
      letter-spacing: 0.02em;
    }
    .badge-fb { background: #1877f2; color: #fff; }
    .badge-g { background: #ea4335; color: #fff; }
    .edit-row { margin: 12px 0; }
    .invited-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 20px;
    }
    .invited-label { font-size: 0.8rem; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: 0.04em; }
    .mini-members-list { display: flex; flex-wrap: wrap; gap: 8px; }
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
      &:hover { background: #ebebeb; }
    }
    .mini-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      overflow: hidden;
      background: #e0e0e0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      flex-shrink: 0;
      img { width: 100%; height: 100%; object-fit: cover; }
    }
    .role-section {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid #f0f0f0;
    }
    .role-section-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
    .role-select { width: 160px; }
    .ban-section {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #f0f0f0;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .force-ban-btn { margin-left: 4px; }
    mat-chip {
      font-size: 0.72rem !important;
      min-height: 22px !important;
    }
    .role-admin { --mdc-chip-label-text-color: #fff; background: #1E4D8C !important; }
    .role-moderator { --mdc-chip-label-text-color: #fff; background: #C9933A !important; }
    .chip-banned { background: #ffccbc !important; }
    .chip-non-validated { background: #f3e5f5 !important; color: #6a1b9a !important; }

    .self-invited-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.85rem;
      color: #6a1b9a;
      background: #f3e5f5;
      padding: 4px 10px;
      border-radius: 20px;

      .self-invited-icon {
        font-size: 0.9rem;
        width: 0.9rem;
        height: 0.9rem;
      }
    }

    .validate-section {
      margin-top: 16px;
      padding: 16px;
      background: #e8f5e9;
      border: 1px solid #a5d6a7;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .validate-info {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      margin: 0;
      font-size: 0.88rem;
      color: #1b5e20;

      .validate-info-icon {
        font-size: 1rem;
        width: 1rem;
        height: 1rem;
        flex-shrink: 0;
        margin-top: 1px;
      }
    }
  `],
})
export class MemberProfileComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(true);
  readonly validating = signal(false);
  readonly profile = signal<MemberProfile | null>(null);

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.load(id);
  }

  private load(id: number): void {
    this.loading.set(true);
    this.http.get<MemberProfile>(`/api/v1/users/${id}`).subscribe({
      next: (p) => { this.profile.set(p); this.loading.set(false); },
      error: () => { this.profile.set(null); this.loading.set(false); },
    });
  }

  isSelf(): boolean {
    return this.authService.currentUser()?.id === this.profile()?.id;
  }

  isAdmin(): boolean {
    return this.authService.currentUser()?.role === 'admin';
  }

  showElevated(): boolean {
    const role = this.authService.currentUser()?.role;
    return role === 'admin' || role === 'moderator';
  }

  showBanControls(): boolean {
    if (this.isSelf()) return false;
    if (!this.showElevated()) return false;
    const targetRole = this.profile()?.role;
    if (targetRole === 'admin') return false;
    if (!this.isAdmin() && targetRole !== 'member') return false;
    return true;
  }

  ban(): void {
    const p = this.profile();
    if (!p) return;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Ban Member', message: `Ban ${p.fullName}? They will be unable to log in but will remain visible in the member list.`, confirmLabel: 'Ban', confirmColor: 'warn' },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.http.post(`/api/v1/admin/users/${p.id}/ban`, {}).subscribe({
        next: () => { this.snackBar.open('Member banned', 'OK', { duration: 3000 }); this.load(p.id); },
        error: (e) => this.snackBar.open(e?.error?.message ?? 'Failed', 'OK', { duration: 4000 }),
      });
    });
  }

  forceBan(): void {
    const p = this.profile();
    if (!p) return;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Forceful Ban', message: `Forcefully ban ${p.fullName}? They will be removed from the member list and cannot log in. This is recorded for audit.`, confirmLabel: 'Force Ban', confirmColor: 'warn' },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.http.post(`/api/v1/admin/users/${p.id}/ban/force`, {}).subscribe({
        next: () => { this.snackBar.open('Member forcefully banned', 'OK', { duration: 3000 }); this.load(p.id); },
        error: (e) => this.snackBar.open(e?.error?.message ?? 'Failed', 'OK', { duration: 4000 }),
      });
    });
  }

  unban(): void {
    const p = this.profile();
    if (!p) return;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: { title: 'Unban Member', message: `Unban ${p.fullName}? They will be able to log in again.`, confirmLabel: 'Unban' },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.http.post(`/api/v1/admin/users/${p.id}/unban`, {}).subscribe({
        next: () => { this.snackBar.open('Member unbanned', 'OK', { duration: 3000 }); this.load(p.id); },
        error: (e) => this.snackBar.open(e?.error?.message ?? 'Failed', 'OK', { duration: 4000 }),
      });
    });
  }

  setRole(role: string): void {
    const p = this.profile();
    if (!p) return;
    this.http.post(`/api/v1/admin/users/${p.id}/role`, { role }).subscribe({
      next: () => {
        this.snackBar.open(`Role updated to ${role}`, 'OK', { duration: 3000 });
        this.load(p.id);
      },
      error: (e) => this.snackBar.open(e?.error?.message ?? 'Failed to update role', 'OK', { duration: 4000 }),
    });
  }

  validateMember(): void {
    const p = this.profile();
    if (!p) return;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Validate Member',
        message: `Vouching for ${p.fullName} upgrades them to full membership. They'll be able to invite guests, submit feedback, and post comments. Only validate someone you've met in person.`,
        confirmLabel: 'I vouch for this person',
        confirmColor: 'primary',
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) return;
      this.validating.set(true);
      this.http.patch(`/api/v1/users/${p.id}/validate`, {}).subscribe({
        next: () => {
          this.validating.set(false);
          this.snackBar.open(`${p.fullName} validated as full member`, 'OK', { duration: 4000 });
          this.load(p.id);
        },
        error: (e) => {
          this.validating.set(false);
          this.snackBar.open(e?.error?.message ?? 'Failed to validate member', 'OK', { duration: 4000 });
        },
      });
    });
  }
}
