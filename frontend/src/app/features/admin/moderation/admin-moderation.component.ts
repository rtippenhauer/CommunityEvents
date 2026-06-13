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
      <mat-chip class="pending-count" [class.has-items]="pendingFlags.length > 0">
        {{ pendingFlags.length }} pending
      </mat-chip>
    </div>

    @if (loading()) {
      <div class="center"><mat-spinner /></div>
    } @else if (flags().length === 0) {
      <div class="empty-state">
        <mat-icon class="empty-icon">check_circle_outline</mat-icon>
        <p>No flagged content. The community is behaving!</p>
      </div>
    } @else {
      <!-- Filter tabs -->
      <div class="filter-tabs">
        <button class="tab-btn" [class.active]="filter() === 'pending'" (click)="filter.set('pending')">
          Pending ({{ pendingFlags.length }})
        </button>
        <button class="tab-btn" [class.active]="filter() === 'all'" (click)="filter.set('all')">
          All ({{ flags().length }})
        </button>
      </div>

      <div class="flags-list">
        @for (f of visibleFlags; track f.id) {
          <div class="flag-card" [class.resolved]="f.status !== 'pending'">
            <div class="flag-header">
              <mat-chip [class]="'type-chip type-' + f.contentType">
                {{ f.contentType === 'announcement' ? 'Announcement' : 'Comment' }}
              </mat-chip>
              <mat-chip [class]="'status-chip status-' + f.status">
                {{ f.status }}
              </mat-chip>
              <span class="flag-time">{{ f.createdAt | date:'MMM d, y h:mm a' }}</span>
            </div>

            <div class="flag-reporter">
              Reported by <strong>{{ f.reporter.fullName }}</strong>
              @if (f.reason) {
                <span class="flag-reason">: "{{ f.reason }}"</span>
              }
            </div>

            <div class="flag-nav">
              <a [routerLink]="f.contentType === 'announcement' ? ['/announcements', f.contentId] : ['/announcements']"
                 class="view-link" target="_blank">
                <mat-icon class="link-icon">open_in_new</mat-icon>
                View {{ f.contentType === 'announcement' ? 'Announcement' : 'Comment' }} #{{ f.contentId }}
              </a>
            </div>

            @if (f.status === 'pending') {
              <div class="flag-actions">
                <button mat-raised-button color="warn" (click)="resolve(f, 'reviewed')">
                  <mat-icon>delete_forever</mat-icon> Remove Content
                </button>
                <button mat-stroked-button (click)="resolve(f, 'dismissed')">
                  <mat-icon>thumb_up</mat-icon> Dismiss
                </button>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    .page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; h1 { margin: 0; font-size: 1.75rem; color: var(--db-brown-dark); } }
    .pending-count { --mdc-chip-label-text-color: #888; &.has-items { --mdc-chip-label-text-color: #b71c1c; --mdc-chip-container-color: #ffebee; font-weight: 700; } }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty-state { text-align: center; padding: 48px 0; color: #888; }
    .empty-icon { font-size: 3rem; width: 3rem; height: 3rem; color: #4caf50; margin-bottom: 8px; }
    .filter-tabs { display: flex; gap: 4px; margin-bottom: 16px; }
    .tab-btn { padding: 6px 16px; border: 1px solid #e8e0d6; background: #fff; border-radius: 20px; cursor: pointer; font-size: 0.85rem; color: #666; &.active { background: var(--db-primary); color: #fff; border-color: var(--db-primary); } }
    .flags-list { display: flex; flex-direction: column; gap: 12px; max-width: 760px; }
    .flag-card { background: #fff; border: 1px solid #e8e0d6; border-radius: 10px; padding: 16px 20px; &.resolved { opacity: 0.65; } }
    .flag-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .type-chip, .status-chip { font-size: 0.68rem !important; height: 20px !important; }
    .type-announcement { --mdc-chip-container-color: #e3f2fd; --mdc-chip-label-text-color: #1565c0; }
    .type-announcement_comment { --mdc-chip-container-color: #f3e5f5; --mdc-chip-label-text-color: #6a1b9a; }
    .status-pending { --mdc-chip-container-color: #fff3e0; --mdc-chip-label-text-color: #e65100; }
    .status-reviewed { --mdc-chip-container-color: #fce4ec; --mdc-chip-label-text-color: #b71c1c; }
    .status-dismissed { --mdc-chip-container-color: #f5f5f5; --mdc-chip-label-text-color: #757575; }
    .flag-time { font-size: 0.72rem; color: #aaa; margin-left: auto; }
    .flag-reporter { font-size: 0.85rem; color: #555; margin-bottom: 6px; }
    .flag-reason { color: #888; font-style: italic; }
    .flag-nav { margin-bottom: 12px; }
    .view-link { display: inline-flex; align-items: center; gap: 4px; font-size: 0.82rem; color: var(--db-primary); text-decoration: none; &:hover { text-decoration: underline; } }
    .link-icon { font-size: 0.9rem; width: 0.9rem; height: 0.9rem; }
    .flag-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  `],
})
export class AdminModerationComponent implements OnInit {
  private readonly announcementsService = inject(AnnouncementsService);
  private readonly snackBar = inject(MatSnackBar);

  readonly flags = signal<ContentFlag[]>([]);
  readonly loading = signal(true);
  readonly filter = signal<'pending' | 'all'>('pending');

  get pendingFlags(): ContentFlag[] {
    return this.flags().filter((f) => f.status === 'pending');
  }

  get visibleFlags(): ContentFlag[] {
    return this.filter() === 'pending' ? this.pendingFlags : this.flags();
  }

  ngOnInit(): void {
    this.announcementsService.adminGetFlags().subscribe({
      next: (list) => { this.flags.set(list as ContentFlag[]); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  resolve(flag: ContentFlag, status: 'reviewed' | 'dismissed'): void {
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
