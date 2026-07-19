import {
  Component,
  computed,
  inject,
  OnInit,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  FeedbackService,
  FeedbackItem,
  FeedbackCategory,
  STATUS_LABELS,
  STATUS_COLORS,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
} from '../../core/services/feedback.service';
import { ReleasesService } from '../../core/services/releases.service';

const COMPLETED_STATUSES = new Set(['shipped', 'wont_fix', 'closed']);

@Component({
  selector: 'app-feedback-board',
  standalone: true,
  imports: [
    RouterLink,
    DatePipe,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatTooltipModule,
  ],
  template: `
    <div class="board-page">
      <div class="page-header">
        <div class="header-text">
          <h1>Feedback Board</h1>
          <p class="subtitle">Upvote ideas, report bugs, and track what we're working on.</p>
        </div>
        <div class="header-actions">
          <button mat-stroked-button routerLink="/updates">
            <mat-icon>campaign</mat-icon> Release Notes
          </button>
          <button mat-raised-button color="primary" routerLink="/feedback/new">
            <mat-icon>add</mat-icon> Submit Feedback
          </button>
        </div>
      </div>

      <!-- Filter tabs -->
      <mat-tab-group (selectedIndexChange)="onTabChange($event)" animationDuration="0">
        <mat-tab label="All" />
        <mat-tab label="Bugs" />
        <mat-tab label="Features" />
        <mat-tab label="Comments" />
      </mat-tab-group>

      <!-- Sort + completed toggle -->
      <div class="sort-bar">
        <div class="sort-left">
          <span class="result-count"
            >{{ visibleItems().length }} item{{ visibleItems().length === 1 ? '' : 's' }}</span
          >
          @if (hiddenCount() > 0) {
            <button
              mat-button
              class="completed-toggle"
              (click)="showCompleted.set(!showCompleted())"
            >
              <mat-icon>{{ showCompleted() ? 'visibility_off' : 'visibility' }}</mat-icon>
              {{ showCompleted() ? 'Hide completed' : 'Show completed (' + hiddenCount() + ')' }}
            </button>
          }
        </div>
        <div class="sort-buttons">
          <button mat-button [class.active-sort]="sort() === 'newest'" (click)="setSort('newest')">
            Newest
          </button>
          <button
            mat-button
            [class.active-sort]="sort() === 'upvotes'"
            (click)="setSort('upvotes')"
          >
            Most Upvoted
          </button>
        </div>
      </div>

      @if (loading()) {
        <div class="center"><mat-spinner /></div>
      } @else if (visibleItems().length === 0) {
        <div class="empty-state">
          <mat-icon>inbox</mat-icon>
          <p>
            {{
              hiddenCount() > 0 ? 'All items are completed.' : 'No feedback yet in this category.'
            }}
          </p>
          @if (hiddenCount() > 0) {
            <button mat-stroked-button (click)="showCompleted.set(true)">
              Show completed items
            </button>
          } @else {
            <button mat-raised-button color="primary" routerLink="/feedback/new">
              Be the first to submit
            </button>
          }
        </div>
      } @else {
        <div class="feedback-list">
          @for (item of visibleItems(); track item.id) {
            <a
              class="feedback-row"
              [routerLink]="['/feedback', item.id]"
              [class.completed-row]="isCompleted(item.status)"
            >
              <!-- Upvote -->
              <button
                class="upvote-btn"
                [class.upvoted]="item.hasUpvoted"
                (click)="toggleUpvote($event, item)"
                [matTooltip]="item.hasUpvoted ? 'Remove upvote' : 'Upvote'"
              >
                <mat-icon>arrow_upward</mat-icon>
                <span>{{ item.upvoteCount }}</span>
              </button>

              <!-- Content -->
              <div class="row-content">
                <div class="row-top">
                  <span
                    class="category-chip"
                    [style.background]="catColor(item.category) + '22'"
                    [style.color]="catColor(item.category)"
                  >
                    {{ catLabel(item.category) }}
                  </span>
                  <span
                    class="status-chip"
                    [style.background]="statusColor(item.status) + '22'"
                    [style.color]="statusColor(item.status)"
                  >
                    {{ statusLabel(item.status) }}
                  </span>
                  @if (item.status === 'shipped' && releaseVersion(item.id)) {
                    <span class="release-badge">
                      <mat-icon>rocket_launch</mat-icon> v{{ releaseVersion(item.id) }}
                    </span>
                  }
                  @if (item.isPrivate) {
                    <mat-icon
                      class="private-icon"
                      matTooltip="Private — only you and admins can see this"
                      >lock</mat-icon
                    >
                  }
                </div>
                <div class="row-title">{{ item.title ?? '(no title)' }}</div>
                <div class="row-meta">
                  <span>{{ item.user?.fullName }}</span>
                  <span class="dot">&middot;</span>
                  <span>{{ item.createdAt | date: 'MMM d, y' }}</span>
                </div>
              </div>

              <mat-icon class="arrow-icon">chevron_right</mat-icon>
            </a>
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .board-page {
        max-width: 800px;
        margin: 0 auto;
        padding: 24px 16px;
      }

      .page-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
        margin-bottom: 24px;
        h1 {
          margin: 0 0 4px;
          font-size: 1.75rem;
          color: var(--db-brown-dark);
        }
      }
      .subtitle {
        margin: 0;
        font-size: 0.9rem;
        color: #666;
      }
      .header-actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        align-items: center;
      }

      .sort-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: 12px 0 16px;
        gap: 8px;
        flex-wrap: wrap;
      }
      .sort-left {
        display: flex;
        align-items: center;
        gap: 4px;
      }
      .result-count {
        font-size: 0.85rem;
        color: #888;
      }
      .completed-toggle {
        font-size: 0.8rem;
        color: #888;
        mat-icon {
          font-size: 0.95rem;
          width: 0.95rem;
          height: 0.95rem;
        }
      }
      .sort-buttons {
        display: flex;
        gap: 4px;
      }
      .active-sort {
        font-weight: 700;
        color: var(--db-blue, #1e4d8c);
      }

      .center {
        display: flex;
        justify-content: center;
        padding: 48px;
      }

      .empty-state {
        text-align: center;
        padding: 48px 0;
        mat-icon {
          font-size: 3rem;
          width: 3rem;
          height: 3rem;
          color: #ccc;
          margin-bottom: 12px;
        }
        p {
          color: #999;
          margin: 0 0 20px;
        }
      }

      .feedback-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .feedback-row {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 16px;
        background: white;
        border-radius: 8px;
        text-decoration: none;
        color: inherit;
        border: 1px solid #eee;
        transition:
          box-shadow 0.15s,
          border-color 0.15s;
        cursor: pointer;
        &:hover {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
          border-color: #ddd;
        }
        &.completed-row {
          opacity: 0.75;
        }
      }

      .upvote-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        min-width: 48px;
        padding: 8px 4px;
        background: #f5f5f5;
        border: 1px solid #e0e0e0;
        border-radius: 8px;
        cursor: pointer;
        font-size: 0.8rem;
        font-weight: 600;
        color: #666;
        transition:
          background 0.15s,
          color 0.15s;
        flex-shrink: 0;
        mat-icon {
          font-size: 1.1rem;
          width: 1.1rem;
          height: 1.1rem;
        }
        &:hover {
          background: #e8f4fd;
          border-color: #90caf9;
          color: #1565c0;
        }
        &.upvoted {
          background: #e3f2fd;
          border-color: #1565c0;
          color: #1565c0;
        }
      }

      .row-content {
        flex: 1;
        min-width: 0;
      }
      .row-top {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 4px;
      }
      .category-chip,
      .status-chip {
        font-size: 0.7rem;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .release-badge {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: 0.7rem;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 10px;
        background: #e8f5e9;
        color: #2e7d32;
        mat-icon {
          font-size: 0.75rem;
          width: 0.75rem;
          height: 0.75rem;
        }
      }
      .private-icon {
        font-size: 0.9rem;
        width: 0.9rem;
        height: 0.9rem;
        color: #aaa;
      }
      .row-title {
        font-size: 0.95rem;
        font-weight: 600;
        color: #222;
        margin-bottom: 4px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .row-meta {
        font-size: 0.8rem;
        color: #999;
        display: flex;
        gap: 6px;
      }
      .dot {
        color: #ccc;
      }

      .arrow-icon {
        color: #ccc;
        flex-shrink: 0;
      }
    `,
  ],
})
export class FeedbackBoardComponent implements OnInit {
  private readonly feedbackService = inject(FeedbackService);
  private readonly releasesService = inject(ReleasesService);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(true);
  readonly allItems = signal<FeedbackItem[]>([]);
  readonly showCompleted = signal(false);
  readonly sort = signal<'newest' | 'upvotes'>('newest');
  readonly releaseMap = signal<Map<number, string>>(new Map());

  readonly visibleItems = computed(() =>
    this.showCompleted()
      ? this.allItems()
      : this.allItems().filter((i) => !COMPLETED_STATUSES.has(i.status)),
  );

  readonly hiddenCount = computed(
    () => this.allItems().filter((i) => COMPLETED_STATUSES.has(i.status)).length,
  );

  private activeCategory: FeedbackCategory | undefined;
  readonly tabCategories: (FeedbackCategory | undefined)[] = [
    undefined,
    'bug',
    'feature_request',
    'comment',
  ];

  ngOnInit(): void {
    this.load();
    this.releasesService.getPublished().subscribe({
      next: (releases) => {
        const map = new Map<number, string>();
        for (const r of releases) {
          for (const fb of r.linkedFeedback ?? []) {
            map.set(fb.id, r.version);
          }
        }
        this.releaseMap.set(map);
      },
      error: () => {},
    });
  }

  private load(): void {
    this.loading.set(true);
    this.feedbackService.getPublicList(this.activeCategory, this.sort()).subscribe({
      next: (data) => {
        this.allItems.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onTabChange(index: number): void {
    this.activeCategory = this.tabCategories[index];
    this.load();
  }

  setSort(s: 'newest' | 'upvotes'): void {
    if (this.sort() === s) return;
    this.sort.set(s);
    this.load();
  }

  toggleUpvote(event: Event, item: FeedbackItem): void {
    event.preventDefault();
    event.stopPropagation();
    this.feedbackService.toggleUpvote(item.id).subscribe({
      next: ({ upvoteCount, hasUpvoted }) => {
        this.allItems.update((list) =>
          list.map((i) => (i.id === item.id ? { ...i, upvoteCount, hasUpvoted } : i)),
        );
      },
      error: () => this.snackBar.open('Failed to update upvote', 'OK', { duration: 3000 }),
    });
  }

  isCompleted(status: string): boolean {
    return COMPLETED_STATUSES.has(status);
  }
  releaseVersion(feedbackId: number): string | undefined {
    return this.releaseMap().get(feedbackId);
  }

  statusLabel(s: string): string {
    return STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s;
  }
  statusColor(s: string): string {
    return STATUS_COLORS[s as keyof typeof STATUS_COLORS] ?? '#555';
  }
  catLabel(c: string): string {
    return CATEGORY_LABELS[c as FeedbackCategory] ?? c;
  }
  catColor(c: string): string {
    return CATEGORY_COLORS[c as FeedbackCategory] ?? '#555';
  }
}
