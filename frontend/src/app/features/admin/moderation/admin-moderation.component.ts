import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AnnouncementsService } from '../../../core/services/announcements.service';
import { ReportsService, AdminReport } from '../../../core/services/reports.service';

interface ContentFlag {
  id: number;
  contentType: 'announcement' | 'announcement_comment';
  contentId: number;
  reason: string | null;
  status: 'pending' | 'reviewed' | 'dismissed';
  createdAt: string;
  reporter: { id: number; fullName: string };
  content?: string;
}

const CONTENT_TYPE_LABELS: Record<string, string> = {
  event_comment: 'Event Comment',
  event_comment_reply: 'Reply',
  announcement_comment: 'Ann. Comment',
  restaurant_rating: 'Rating',
};

@Component({
  selector: 'app-admin-moderation',
  standalone: true,
  imports: [
    DatePipe, RouterLink,
    MatButtonModule, MatChipsModule, MatIconModule,
    MatProgressSpinnerModule, MatSnackBarModule, MatTooltipModule,
  ],
  template: `
    <div class="page-header">
      <h1>Moderation Queue</h1>
    </div>

    <!-- ── Content Reports (new system) ── -->
    <section class="section">
      <div class="section-header">
        <h2>Content Reports</h2>
        @if (reports().length > 0) {
          <span class="badge badge-warn">{{ reports().length }} pending</span>
        }
      </div>

      @if (reportsLoading()) {
        <div class="center"><mat-spinner diameter="32" /></div>
      } @else if (reports().length === 0) {
        <div class="empty-state">
          <mat-icon class="empty-icon">check_circle_outline</mat-icon>
          <p>No pending reports.</p>
        </div>
      } @else {
        <div class="cards-list">
          @for (r of reports(); track r.id) {
            <div class="mod-card">
              <div class="card-header">
                <mat-chip [class]="'type-chip type-' + r.contentType">
                  {{ contentTypeLabel(r.contentType) }}
                </mat-chip>
                <span class="card-time">{{ r.createdAt | date:'MMM d, y h:mm a' }}</span>
              </div>

              <div class="card-preview">"{{ r.contentPreview }}"</div>

              <div class="card-reporter">
                Reported by <strong>{{ r.reportedBy.fullName }}</strong>
                @if (r.reason) {
                  <span class="card-reason">: "{{ r.reason }}"</span>
                }
              </div>

              <div class="card-actions">
                <button mat-stroked-button color="warn" (click)="deleteAndDismiss(r)">
                  <mat-icon>delete_forever</mat-icon> Delete &amp; Dismiss
                </button>
                <button mat-stroked-button (click)="dismissReport(r)">
                  <mat-icon>thumb_up</mat-icon> Dismiss
                </button>
              </div>
            </div>
          }
        </div>
      }
    </section>

    <div class="section-divider"></div>

    <!-- ── Announcement Flags (legacy system) ── -->
    <section class="section">
      <div class="section-header">
        <h2>Announcement Flags</h2>
        @if (pendingFlags.length > 0) {
          <span class="badge badge-warn">{{ pendingFlags.length }} pending</span>
        }
      </div>

      @if (flagsLoading()) {
        <div class="center"><mat-spinner diameter="32" /></div>
      } @else if (flags().length === 0) {
        <div class="empty-state">
          <mat-icon class="empty-icon">check_circle_outline</mat-icon>
          <p>No flagged announcements.</p>
        </div>
      } @else {
        <div class="filter-tabs">
          <button class="tab-btn" [class.active]="flagFilter() === 'pending'" (click)="flagFilter.set('pending')">
            Pending ({{ pendingFlags.length }})
          </button>
          <button class="tab-btn" [class.active]="flagFilter() === 'all'" (click)="flagFilter.set('all')">
            All ({{ flags().length }})
          </button>
        </div>

        <div class="cards-list">
          @for (f of visibleFlags; track f.id) {
            <div class="mod-card" [class.resolved]="f.status !== 'pending'">
              <div class="card-header">
                <mat-chip [class]="'type-chip type-' + f.contentType">
                  {{ f.contentType === 'announcement' ? 'Announcement' : 'Comment' }}
                </mat-chip>
                <mat-chip [class]="'status-chip status-' + f.status">{{ f.status }}</mat-chip>
                <span class="card-time">{{ f.createdAt | date:'MMM d, y h:mm a' }}</span>
              </div>

              <div class="card-reporter">
                Reported by <strong>{{ f.reporter.fullName }}</strong>
                @if (f.reason) {
                  <span class="card-reason">: "{{ f.reason }}"</span>
                }
              </div>

              <div class="card-nav">
                <a [routerLink]="f.contentType === 'announcement' ? ['/announcements', f.contentId] : ['/announcements']"
                   class="view-link" target="_blank">
                  <mat-icon class="link-icon">open_in_new</mat-icon>
                  View {{ f.contentType === 'announcement' ? 'Announcement' : 'Comment' }} #{{ f.contentId }}
                </a>
              </div>

              @if (f.status === 'pending') {
                <div class="card-actions">
                  <button mat-stroked-button color="warn" (click)="resolveFlag(f, 'reviewed')">
                    <mat-icon>delete_forever</mat-icon> Remove Content
                  </button>
                  <button mat-stroked-button (click)="resolveFlag(f, 'dismissed')">
                    <mat-icon>thumb_up</mat-icon> Dismiss
                  </button>
                </div>
              }
            </div>
          }
        </div>
      }
    </section>
  `,
  styles: [`
    .page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; h1 { margin: 0; font-size: 1.75rem; color: var(--db-brown-dark); } }
    .section { max-width: 760px; }
    .section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; h2 { margin: 0; font-size: 1.2rem; font-weight: 600; color: var(--db-brown-dark); } }
    .badge { font-size: 0.72rem; padding: 2px 8px; border-radius: 12px; font-weight: 700; }
    .badge-warn { background: #ffebee; color: #b71c1c; }
    .section-divider { border-top: 1px solid #e8e0d6; margin: 32px 0; max-width: 760px; }
    .center { display: flex; justify-content: center; padding: 32px; }
    .empty-state { text-align: center; padding: 24px 0; color: #888; p { margin: 4px 0 0; } }
    .empty-icon { font-size: 2.5rem; width: 2.5rem; height: 2.5rem; color: #4caf50; }
    .filter-tabs { display: flex; gap: 4px; margin-bottom: 14px; }
    .tab-btn { padding: 5px 14px; border: 1px solid #e8e0d6; background: #fff; border-radius: 20px; cursor: pointer; font-size: 0.83rem; color: #666; &.active { background: var(--db-primary); color: #fff; border-color: var(--db-primary); } }
    .cards-list { display: flex; flex-direction: column; gap: 12px; }
    .mod-card { background: #fff; border: 1px solid #e8e0d6; border-radius: 10px; padding: 14px 18px; &.resolved { opacity: 0.6; } }
    .card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .card-time { font-size: 0.7rem; color: #aaa; margin-left: auto; }
    .type-chip, .status-chip { font-size: 0.67rem !important; height: 20px !important; }
    .type-event_comment { --mat-chip-container-color: #e8f5e9; --mat-chip-label-text-color: #2e7d32; }
    .type-event_comment_reply { --mat-chip-container-color: #f1f8e9; --mat-chip-label-text-color: #558b2f; }
    .type-announcement_comment { --mat-chip-container-color: #f3e5f5; --mat-chip-label-text-color: #6a1b9a; }
    .type-restaurant_rating { --mat-chip-container-color: #fff8e1; --mat-chip-label-text-color: #f57f17; }
    .type-announcement { --mat-chip-container-color: #e3f2fd; --mat-chip-label-text-color: #1565c0; }
    .type-announcement_comment { --mat-chip-container-color: #f3e5f5; --mat-chip-label-text-color: #6a1b9a; }
    .status-pending { --mat-chip-container-color: #fff3e0; --mat-chip-label-text-color: #e65100; }
    .status-reviewed { --mat-chip-container-color: #fce4ec; --mat-chip-label-text-color: #b71c1c; }
    .status-dismissed { --mat-chip-container-color: #f5f5f5; --mat-chip-label-text-color: #757575; }
    .card-preview { font-size: 0.875rem; color: #444; font-style: italic; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .card-reporter { font-size: 0.82rem; color: #555; margin-bottom: 8px; }
    .card-reason { color: #888; font-style: italic; }
    .card-nav { margin-bottom: 10px; }
    .view-link { display: inline-flex; align-items: center; gap: 4px; font-size: 0.82rem; color: var(--db-primary); text-decoration: none; &:hover { text-decoration: underline; } }
    .link-icon { font-size: 0.85rem; width: 0.85rem; height: 0.85rem; }
    .card-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  `],
})
export class AdminModerationComponent implements OnInit {
  private readonly announcementsService = inject(AnnouncementsService);
  private readonly reportsService = inject(ReportsService);
  private readonly snackBar = inject(MatSnackBar);

  readonly reports = signal<AdminReport[]>([]);
  readonly reportsLoading = signal(true);

  readonly flags = signal<ContentFlag[]>([]);
  readonly flagsLoading = signal(true);
  readonly flagFilter = signal<'pending' | 'all'>('pending');

  get pendingFlags(): ContentFlag[] {
    return this.flags().filter((f) => f.status === 'pending');
  }

  get visibleFlags(): ContentFlag[] {
    return this.flagFilter() === 'pending' ? this.pendingFlags : this.flags();
  }

  contentTypeLabel(type: string): string {
    return CONTENT_TYPE_LABELS[type] ?? type;
  }

  ngOnInit(): void {
    this.reportsService.getAdminReports().subscribe({
      next: (list) => { this.reports.set(list); this.reportsLoading.set(false); },
      error: () => this.reportsLoading.set(false),
    });
    this.announcementsService.adminGetFlags().subscribe({
      next: (list) => { this.flags.set(list as ContentFlag[]); this.flagsLoading.set(false); },
      error: () => this.flagsLoading.set(false),
    });
  }

  dismissReport(r: AdminReport): void {
    this.reportsService.review(r.id, 'dismiss').subscribe({
      next: () => {
        this.reports.update((list) => list.filter((x) => x.id !== r.id));
        this.snackBar.open('Report dismissed.', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Action failed.', 'OK', { duration: 3000 }),
    });
  }

  deleteAndDismiss(r: AdminReport): void {
    this.reportsService.review(r.id, 'delete_and_dismiss').subscribe({
      next: () => {
        this.reports.update((list) => list.filter((x) => x.id !== r.id));
        this.snackBar.open('Content deleted and report dismissed.', 'OK', { duration: 3500 });
      },
      error: () => this.snackBar.open('Action failed.', 'OK', { duration: 3000 }),
    });
  }

  resolveFlag(flag: ContentFlag, status: 'reviewed' | 'dismissed'): void {
    this.announcementsService.adminResolveFlag(flag.id, status).subscribe({
      next: (updated) => {
        this.flags.update((list) => list.map((f) => (f.id === flag.id ? { ...f, status: (updated as ContentFlag).status } : f)));
        const msg = status === 'reviewed' ? 'Marked reviewed — remember to remove the content manually.' : 'Flag dismissed.';
        this.snackBar.open(msg, 'OK', { duration: 3500 });
      },
      error: () => this.snackBar.open('Action failed.', 'OK', { duration: 3000 }),
    });
  }
}
