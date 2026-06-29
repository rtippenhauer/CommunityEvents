import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { FeedbackService, MemberFeedbackStats } from '../../core/services/feedback.service';
import { CommunityService, PointSummary, Achievement } from '../../core/services/community.service';

interface MiniMember {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
}

interface MyProfile {
  invitedBy: MiniMember | null;
  invitedMembers: MiniMember[];
}

const PROGRESS_LABELS: Record<string, string> = {
  attendance: 'Dinners Attended',
  coordinator: 'Events Coordinated',
  new_restaurant_coordinator: 'New Restaurants Coordinated',
  invite: 'Members Invited',
  rating: 'Restaurant Ratings',
  founding: 'Founding Member',
  event: 'Special Dinner',
};

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    RouterLink,
    DatePipe,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatSelectModule,
    MatFormFieldModule,
    MatTooltipModule,
    MatSnackBarModule,
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

      <!-- Bear Points card -->
      @if (points()) {
        <mat-card class="stats-card">
          <mat-card-header>
            <mat-card-title>
              <span>Bear Points</span>
              <span class="points-total-badge">{{ points()!.total }}</span>
            </mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <div class="stats-row">
              @if ((points()!.byType['attendance'] ?? 0) > 0) {
                <div class="stat-item">
                  <span class="stat-value">{{ points()!.byType['attendance'] }}</span>
                  <span class="stat-label">Attendance</span>
                </div>
              }
              @if (((points()!.byType['coordinator'] ?? 0) + (points()!.byType['coordinator_new_restaurant'] ?? 0)) > 0) {
                <div class="stat-item">
                  <span class="stat-value">{{ (points()!.byType['coordinator'] ?? 0) + (points()!.byType['coordinator_new_restaurant'] ?? 0) }}</span>
                  <span class="stat-label">Coordinator</span>
                </div>
              }
              @if ((points()!.byType['invite'] ?? 0) > 0) {
                <div class="stat-item">
                  <span class="stat-value">{{ points()!.byType['invite'] }}</span>
                  <span class="stat-label">Invites</span>
                </div>
              }
              @if ((points()!.byType['rating'] ?? 0) > 0) {
                <div class="stat-item">
                  <span class="stat-value">{{ points()!.byType['rating'] }}</span>
                  <span class="stat-label">Ratings</span>
                </div>
              }
            </div>
          </mat-card-content>
        </mat-card>
      }

      <!-- Achievements -->
      @if (achievements()) {
        <div class="achievements-section">
          <div class="achievements-header">
            <h3 class="section-title">Achievements</h3>
            @if (earnedTitles().length > 0) {
              <mat-form-field appearance="outline" class="title-picker" subscriptSizing="dynamic">
                <mat-label>Active Title</mat-label>
                <mat-select [value]="activeTitle()" (selectionChange)="setTitle($event.value)">
                  <mat-option [value]="null">None</mat-option>
                  @for (t of earnedTitles(); track t) {
                    <mat-option [value]="t">{{ t }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }
          </div>

          <div class="achievements-grid">
            @for (a of achievements()!; track a.id) {
              <div class="ach-card" [class.earned]="a.earned" [class.locked]="!a.earned">
                <div class="ach-graphic">
                  @if (a.imagePath) {
                    <img [src]="a.imagePath" [alt]="a.name" class="ach-image" />
                  } @else {
                    <mat-icon class="ach-icon">{{ a.earned ? a.icon : 'lock' }}</mat-icon>
                  }
                </div>
                <div class="ach-body">
                  <div class="ach-name">{{ a.name }}</div>
                  @if (a.title) {
                    <div class="ach-title-badge">Title: {{ a.title }}</div>
                  }
                  @if (a.points > 0) {
                    <div class="ach-points">+{{ a.points }} pts</div>
                  }
                  <div class="ach-description">{{ a.description }}</div>

                  @if (!a.earned && a.progressTarget && a.progressType !== 'founding' && a.progressType !== 'event') {
                    <div class="ach-progress">
                      <mat-progress-bar
                        mode="determinate"
                        [value]="progressPct(a)"
                        [color]="'primary'">
                      </mat-progress-bar>
                      <div class="ach-progress-label">
                        {{ a.progressCurrent }} of {{ a.progressTarget }} {{ progressLabel(a.progressType) }}
                      </div>
                    </div>
                  }

                  @if (a.earned && a.earnedAt) {
                    <div class="ach-earned-date">Earned {{ a.earnedAt | date:'mediumDate' }}</div>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .profile-container {
      max-width: 680px;
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
    .profile-info { flex: 1; min-width: 0; }
    .profile-name { font-size: 1.2rem; font-weight: 700; margin: 0 0 4px; color: #1a1a1a; }
    .profile-email { font-size: 0.875rem; color: #888; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .edit-btn { flex-shrink: 0; }
    .connections-card mat-card-content { padding: 12px 16px; }
    .connection-row {
      display: flex;
      flex-direction: column;
      gap: 8px;
      & + .connection-row { margin-top: 16px; }
    }
    .connection-label { font-size: 0.75rem; font-weight: 600; color: #999; text-transform: uppercase; letter-spacing: 0.04em; }
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
      width: 28px; height: 28px; border-radius: 50%; overflow: hidden; background: #e0e0e0; flex-shrink: 0;
      img { width: 100%; height: 100%; object-fit: cover; }
    }
    .stats-card mat-card-content { padding-top: 8px; }
    .stats-row { display: flex; gap: 16px; flex-wrap: wrap; }
    .stat-item {
      flex: 1; min-width: 90px;
      display: flex; flex-direction: column; align-items: center;
      padding: 16px 8px; border-radius: 10px; background: #f5f5f5;
      text-decoration: none; color: inherit; transition: background 0.15s;
      &:hover { background: #e8f4fd; }
      &.shipped { background: #e8f5e9; &:hover { background: #c8e6c9; } }
    }
    .stat-value { font-size: 1.75rem; font-weight: 800; color: var(--db-blue, #1E4D8C); line-height: 1; margin-bottom: 4px; }
    .stat-item.shipped .stat-value { color: #2e7d32; }
    .stat-label { font-size: 0.75rem; color: #888; text-align: center; }
    mat-card-title { display: flex; align-items: center; gap: 10px; }
    .points-total-badge {
      font-size: 0.9rem; font-weight: 800;
      background: #1E4D8C; color: #fff;
      border-radius: 12px; padding: 2px 10px;
    }

    /* Achievements section */
    .achievements-section { display: flex; flex-direction: column; gap: 12px; }
    .achievements-header {
      display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
    }
    .section-title { margin: 0; font-size: 1.1rem; font-weight: 700; color: #333; }
    .title-picker { width: 200px; }

    .achievements-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 12px;
    }

    .ach-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      border-radius: 12px;
      padding: 16px 12px 12px;
      text-align: center;
      border: 2px solid transparent;
      transition: box-shadow 0.15s, border-color 0.15s;
      &.earned {
        background: #f0f5ff;
        border-color: #1E4D8C;
        box-shadow: 0 2px 8px rgba(30,77,140,0.12);
      }
      &.locked {
        background: #fafafa;
        border-color: #e0e0e0;
        opacity: 0.72;
      }
    }

    .ach-graphic {
      width: 72px; height: 72px;
      border-radius: 50%;
      overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      background: #fff;
      margin-bottom: 10px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    }
    .ach-image { width: 100%; height: 100%; object-fit: cover; }
    .ach-icon {
      font-size: 2.2rem; width: 2.2rem; height: 2.2rem;
      .earned & { color: #C9933A; }
      .locked & { color: #ccc; }
    }

    .ach-body { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; }
    .ach-name { font-weight: 700; font-size: 0.9rem; color: #222; }
    .ach-title-badge {
      font-size: 0.72rem; font-weight: 600;
      background: #C9933A; color: #fff;
      border-radius: 8px; padding: 2px 8px;
    }
    .ach-points { font-size: 0.75rem; color: #1E4D8C; font-weight: 700; }
    .ach-description { font-size: 0.78rem; color: #777; line-height: 1.35; margin-top: 2px; }
    .ach-progress { width: 100%; margin-top: 8px; }
    .ach-progress-label { font-size: 0.72rem; color: #888; margin-top: 4px; }
    .ach-earned-date { font-size: 0.72rem; color: #999; margin-top: 6px; }

    @media (max-width: 480px) {
      .achievements-grid { grid-template-columns: 1fr 1fr; }
    }
  `],
})
export class ProfileComponent implements OnInit {
  readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly feedbackService = inject(FeedbackService);
  private readonly communityService = inject(CommunityService);
  private readonly snackBar = inject(MatSnackBar);

  readonly photoUrl = signal<string | null>(null);
  readonly myProfile = signal<MyProfile | null>(null);
  readonly feedbackStats = signal<MemberFeedbackStats | null>(null);
  readonly points = signal<PointSummary | null>(null);
  readonly achievements = signal<Achievement[] | null>(null);
  readonly activeTitle = signal<string | null>(null);

  readonly earnedTitles = computed(() =>
    (this.achievements() ?? [])
      .filter((a) => a.earned && a.title)
      .map((a) => a.title as string),
  );

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
    this.communityService.getMyPoints().subscribe({
      next: (p) => this.points.set(p),
      error: () => {},
    });
    this.communityService.getMyAchievements().subscribe({
      next: (a) => this.achievements.set(a),
      error: () => {},
    });
    this.http.get<{ selectedTitle: string | null }>('/api/v1/users/me').subscribe({
      next: (r) => this.activeTitle.set(r.selectedTitle),
      error: () => {},
    });
  }

  setTitle(title: string | null): void {
    this.communityService.selectTitle(title).subscribe({
      next: () => {
        this.activeTitle.set(title);
        this.snackBar.open(title ? `Title set to "${title}"` : 'Title cleared', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Could not update title', 'OK', { duration: 3000 }),
    });
  }

  progressPct(a: Achievement): number {
    if (!a.progressTarget || a.progressTarget === 0) return 0;
    return Math.min(100, Math.round((a.progressCurrent / a.progressTarget) * 100));
  }

  progressLabel(type: string | null): string {
    return type ? (PROGRESS_LABELS[type] ?? type) : '';
  }

  private loadMyProfile(): void {
    const user = this.authService.currentUser();
    if (!user) return;
    this.http.get<MyProfile>(`/api/v1/users/${user.id}`).subscribe({
      next: (p) => this.myProfile.set(p),
    });
  }
}
