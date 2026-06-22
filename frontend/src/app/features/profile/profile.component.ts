import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';
import { FeedbackService, MemberFeedbackStats } from '../../core/services/feedback.service';

interface MiniMember {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
}

interface MyProfile {
  invitedBy: MiniMember | null;
  invitedMembers: MiniMember[];
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="profile-container">
      <!-- Profile header card -->
      <mat-card class="profile-card">
        <mat-card-content class="profile-header">
          <div class="profile-photo-wrap">
            @if (photoUrl()) {
              <img [src]="photoUrl()!" alt="Profile photo" class="profile-photo" />
            } @else {
              <img src="/avatars/bear-default.jpg" alt="Bear avatar" class="profile-photo" />
            }
          </div>
          <div class="profile-info">
            <h2 class="profile-name">{{ authService.currentUser()?.fullName }}</h2>
            <p class="profile-email">{{ authService.currentUser()?.email }}</p>
          </div>
          <a mat-stroked-button routerLink="/profile/settings" class="edit-btn">
            <mat-icon>edit</mat-icon> Edit
          </a>
        </mat-card-content>
      </mat-card>

      <!-- Connections card -->
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
  styles: [`
    .profile-container {
      max-width: 600px;
      margin: 0 auto;
      padding: 24px 16px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .profile-header {
      display: flex;
      align-items: center;
      gap: 20px;
      padding: 20px 16px !important;
    }
    .profile-photo-wrap {
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
    .profile-info {
      flex: 1;
      min-width: 0;
    }
    .profile-name {
      font-size: 1.2rem;
      font-weight: 700;
      margin: 0 0 4px;
      color: #1a1a1a;
    }
    .profile-email {
      font-size: 0.875rem;
      color: #888;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .edit-btn {
      flex-shrink: 0;
    }
    .connections-card mat-card-content {
      padding: 12px 16px;
    }
    .connection-row {
      display: flex;
      flex-direction: column;
      gap: 8px;
      & + .connection-row { margin-top: 16px; }
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
      &:hover { background: #ebebeb; }
    }
    .mini-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      overflow: hidden;
      background: #e0e0e0;
      flex-shrink: 0;
      img { width: 100%; height: 100%; object-fit: cover; }
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
  `],
})
export class ProfileComponent implements OnInit {
  readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly feedbackService = inject(FeedbackService);

  readonly photoUrl = signal<string | null>(null);
  readonly myProfile = signal<MyProfile | null>(null);
  readonly feedbackStats = signal<MemberFeedbackStats | null>(null);

  ngOnInit(): void {
    const user = this.authService.currentUser();
    if (user) {
      this.photoUrl.set(user.profilePhotoPath ?? null);
    }
    this.loadMyProfile();
    this.feedbackService.getMyStats().subscribe({
      next: (stats) => this.feedbackStats.set(stats),
      error: () => {},
    });
  }

  private loadMyProfile(): void {
    const user = this.authService.currentUser();
    if (!user) return;
    this.http.get<MyProfile>(`/api/v1/users/${user.id}`).subscribe({
      next: (p) => this.myProfile.set(p),
    });
  }
}
