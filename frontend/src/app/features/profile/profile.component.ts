import {
  Component,
  inject,
  OnInit,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
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
  new_location_coordinator: 'New Restaurants Coordinated',
  invite: 'Members Invited',
  rating: 'Restaurant Ratings',
  founding: 'Founding Member',
  event: 'Special Dinner',
};

const ACHIEVEMENT_CATEGORIES: Record<string, { label: string; icon: string }> = {
  attendance: { label: 'Attendance', icon: 'local_dining' },
  coordinator: { label: 'Coordinator', icon: 'event_available' },
  new_location_coordinator: { label: 'Scout', icon: 'travel_explore' },
  invite: { label: 'Invites', icon: 'person_add' },
  rating: { label: 'Ratings', icon: 'star' },
  city_hopper: { label: 'City Hopper', icon: 'flight' },
  secret_dinner: { label: 'Secret Dinners', icon: 'lock' },
  founding: { label: 'Founding Bear', icon: 'history_edu' },
  event: { label: 'Special Dinners', icon: 'celebration' },
  login: { label: 'Site Visits', icon: 'login' },
  other: { label: 'Special', icon: 'emoji_events' },
};

const ACHIEVEMENT_CATEGORY_ORDER = [
  'attendance',
  'coordinator',
  'new_location_coordinator',
  'invite',
  'rating',
  'city_hopper',
  'secret_dinner',
  'login',
  'founding',
  'event',
  'other',
];

interface AchievementGroup {
  category: string;
  label: string;
  icon: string;
  earned: Achievement[];
  next: Achievement | null;
  allComplete: boolean;
  isProgressive: boolean;
}

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
        @if ((points()?.total ?? 0) > 0 && authService.currentUser()?.role !== 'admin') {
          <div class="paw-badge">
            <svg viewBox="0 0 56 54" xmlns="http://www.w3.org/2000/svg" class="paw-svg">
              <circle cx="10" cy="20" r="7" fill="#8B5E3C" />
              <circle cx="21" cy="13" r="7" fill="#8B5E3C" />
              <circle cx="35" cy="13" r="7" fill="#8B5E3C" />
              <circle cx="46" cy="20" r="7" fill="#8B5E3C" />
              <circle cx="28" cy="38" r="14" fill="#8B5E3C" />
              <text
                x="28"
                y="38"
                text-anchor="middle"
                dominant-baseline="central"
                fill="white"
                font-size="13"
                font-weight="800"
                font-family="system-ui,sans-serif"
              >
                {{ points()!.total }}
              </text>
            </svg>
          </div>
        }
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

      <!-- Achievements -->
      @if (groupedAchievements().length > 0) {
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

          @for (group of groupedAchievements(); track group.category) {
            <mat-card class="ach-group-card">
              <div class="ach-group-header">
                <mat-icon class="ach-group-icon">{{ group.icon }}</mat-icon>
                <span class="ach-group-label">{{ group.label }}</span>
                @if (group.isProgressive && group.allComplete) {
                  <span class="ach-complete-badge">All unlocked</span>
                }
              </div>

              @if (group.earned.length > 0) {
                <div class="ach-earned-list">
                  @for (a of group.earned; track a.id) {
                    <div class="ach-earned-row">
                      @if (a.imagePath) {
                        <img [src]="a.imagePath" [alt]="a.name" class="ach-row-img" />
                      } @else if (isImgIcon(a.icon)) {
                        <img [src]="imgIconSrc(a.icon)" [alt]="a.name" class="ach-row-img" />
                      } @else {
                        <mat-icon class="ach-icon">{{ a.icon }}</mat-icon>
                      }
                      <div class="ach-earned-info">
                        <span class="ach-earned-name">{{ a.name }}</span>
                        @if (a.title) {
                          <span class="ach-title-badge">{{ a.title }}</span>
                        }
                      </div>
                      @if (a.earnedAt) {
                        <span class="ach-earned-when">{{ a.earnedAt | date: 'MMM d, y' }}</span>
                      }
                    </div>
                  }
                </div>
              }

              @if (group.next; as next) {
                <div class="ach-next" [class.with-divider]="group.earned.length > 0">
                  <div class="ach-next-row">
                    <mat-icon class="ach-lock-icon">lock</mat-icon>
                    <div class="ach-next-info">
                      <span class="ach-next-name">{{ next.name }}</span>
                      @if (next.title) {
                        <span class="ach-next-title-hint">Unlocks title: {{ next.title }}</span>
                      }
                      <span class="ach-next-desc">{{ next.description }}</span>
                    </div>
                  </div>
                  @if (
                    next.progressTarget &&
                    next.progressType !== 'founding' &&
                    next.progressType !== 'event'
                  ) {
                    <div class="ach-next-progress">
                      <mat-progress-bar
                        mode="determinate"
                        [value]="progressPct(next)"
                      ></mat-progress-bar>
                      <div class="ach-progress-label">
                        {{ next.progressCurrent }} of {{ next.progressTarget }}
                        {{ progressLabel(next.progressType) }}
                      </div>
                    </div>
                  }
                </div>
              }
            </mat-card>
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
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
        flex-shrink: 0;
        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      }
      .stats-card mat-card-content {
        padding-top: 8px;
      }
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
        &:hover {
          background: #e8f4fd;
        }
        &.shipped {
          background: #e8f5e9;
          &:hover {
            background: #c8e6c9;
          }
        }
      }
      .stat-value {
        font-size: 1.75rem;
        font-weight: 800;
        color: var(--db-primary);
        line-height: 1;
        margin-bottom: 4px;
      }
      .stat-item.shipped .stat-value {
        color: #2e7d32;
      }
      .stat-label {
        font-size: 0.75rem;
        color: #888;
        text-align: center;
      }
      mat-card-title {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      /* Paw badge on profile card */
      .profile-card {
        position: relative;
        overflow: visible !important;
      }
      .paw-badge {
        position: absolute;
        top: -12px;
        right: 12px;
        z-index: 1;
      }
      .paw-svg {
        width: 46px;
        height: 46px;
        filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.18));
      }

      /* Achievements section */
      .achievements-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .achievements-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
      }
      .section-title {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 700;
        color: #333;
      }
      .title-picker {
        width: 200px;
      }

      /* Group card */
      .ach-group-card {
        padding: 0 !important;
        overflow: hidden;
      }

      .ach-group-header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 16px;
        background: var(--db-primary);
        color: #fff;
      }
      .ach-group-icon {
        font-size: 1.2rem;
        width: 1.2rem;
        height: 1.2rem;
        flex-shrink: 0;
        opacity: 0.9;
      }
      .ach-group-label {
        font-weight: 700;
        font-size: 0.95rem;
        flex: 1;
      }
      .ach-complete-badge {
        font-size: 0.7rem;
        font-weight: 700;
        background: var(--db-primary);
        color: #fff;
        border-radius: 10px;
        padding: 2px 8px;
        white-space: nowrap;
      }

      /* Earned rows */
      .ach-earned-list {
        padding: 4px 0;
      }
      .ach-earned-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 16px;
        &:not(:last-child) {
          border-bottom: 1px solid #f0f0f0;
        }
      }
      .ach-icon {
        color: var(--db-primary);
        font-size: 1.5rem;
        width: 1.5rem;
        height: 1.5rem;
        flex-shrink: 0;
      }
      .ach-row-img {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
      }
      .ach-earned-info {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 1;
        min-width: 0;
        flex-wrap: wrap;
      }
      .ach-earned-name {
        font-size: 0.88rem;
        font-weight: 600;
        color: #222;
      }
      .ach-title-badge {
        font-size: 0.68rem;
        font-weight: 700;
        background: var(--db-primary);
        color: #fff;
        border-radius: 8px;
        padding: 1px 7px;
      }
      .ach-earned-when {
        font-size: 0.72rem;
        color: #aaa;
        white-space: nowrap;
        flex-shrink: 0;
        margin-left: auto;
      }

      /* Next tier */
      .ach-next {
        padding: 10px 16px 12px;
        background: #fafafa;
        &.with-divider {
          border-top: 2px dashed #e8e8e8;
        }
      }
      .ach-next-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin-bottom: 6px;
      }
      .ach-lock-icon {
        color: #bbb;
        font-size: 1.1rem;
        width: 1.1rem;
        height: 1.1rem;
        flex-shrink: 0;
        margin-top: 2px;
      }
      .ach-next-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
      }
      .ach-next-name {
        font-size: 0.88rem;
        font-weight: 600;
        color: #555;
      }
      .ach-next-title-hint {
        font-size: 0.7rem;
        color: var(--db-primary);
        font-weight: 600;
      }
      .ach-next-desc {
        font-size: 0.78rem;
        color: #999;
        line-height: 1.35;
      }
      .ach-next-progress {
        padding-left: 21px;
      }
      .ach-progress-label {
        font-size: 0.72rem;
        color: #888;
        margin-top: 4px;
      }
    `,
  ],
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
    (this.achievements() ?? []).filter((a) => a.earned && a.title).map((a) => a.title as string),
  );

  readonly groupedAchievements = computed<AchievementGroup[]>(() => {
    const all = this.achievements();
    if (!all) return [];

    const byType = new Map<string, Achievement[]>();
    for (const a of all) {
      if (a.isSecret && !a.earned) continue;
      const key = a.progressType ?? 'other';
      if (!byType.has(key)) byType.set(key, []);
      byType.get(key)!.push(a);
    }

    const groups: AchievementGroup[] = [];

    for (const cat of ACHIEVEMENT_CATEGORY_ORDER) {
      const items = byType.get(cat);
      if (!items || items.length === 0) continue;

      const sorted = [...items].sort((a, b) => (a.progressTarget ?? 0) - (b.progressTarget ?? 0));
      const earned = sorted.filter((a) => a.earned);
      const unearned = sorted.filter((a) => !a.earned);
      const next = unearned[0] ?? null;
      const isProgressive = cat !== 'founding' && cat !== 'event' && cat !== 'other';

      if (earned.length === 0) {
        if (!isProgressive) continue;
        if ((next?.progressCurrent ?? 0) === 0) continue;
      }

      const config = ACHIEVEMENT_CATEGORIES[cat] ?? { label: cat, icon: 'emoji_events' };
      groups.push({
        category: cat,
        label: config.label,
        icon: config.icon,
        earned,
        next,
        allComplete: unearned.length === 0,
        isProgressive,
      });
    }

    return groups;
  });

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
        this.snackBar.open(title ? `Title set to "${title}"` : 'Title cleared', 'OK', {
          duration: 3000,
        });
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

  isImgIcon(icon: string): boolean {
    return icon.startsWith('img:');
  }

  imgIconSrc(icon: string): string {
    return icon.slice(4);
  }

  private loadMyProfile(): void {
    const user = this.authService.currentUser();
    if (!user) return;
    this.http.get<MyProfile>(`/api/v1/users/${user.id}`).subscribe({
      next: (p) => this.myProfile.set(p),
    });
  }
}
