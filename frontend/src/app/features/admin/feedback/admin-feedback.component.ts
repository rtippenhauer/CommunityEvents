import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { FeedbackService, FeedbackItem, FeedbackStatus } from '../../../core/services/feedback.service';

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'New',
  under_review: 'Under Review',
  in_progress: 'In Progress',
  released: 'Released',
  wont_do: "Won't Do",
  duplicate: 'Duplicate',
};

const STATUS_COLORS: Record<FeedbackStatus, string> = {
  new: '#1565c0',
  under_review: '#6a1b9a',
  in_progress: '#e65100',
  released: '#2e7d32',
  wont_do: '#757575',
  duplicate: '#9e9e9e',
};

const CATEGORY_LABELS: Record<string, string> = {
  bug: 'Bug',
  feature_request: 'Feature Request',
  comment: 'Comment',
};

const CATEGORY_COLORS: Record<string, string> = {
  bug: '#c62828',
  feature_request: '#1565c0',
  comment: '#555',
};

@Component({
  selector: 'app-admin-feedback',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
  ],
  template: `
    <div class="feedback-admin">
      <div class="page-header">
        <h1>Feedback</h1>
        <span class="item-count">{{ filtered().length }} item{{ filtered().length === 1 ? '' : 's' }}</span>
      </div>

      <!-- Filters -->
      <div class="filters">
        <mat-form-field appearance="outline" class="filter-field">
          <mat-label>Status</mat-label>
          <mat-select [(ngModel)]="filterStatus" (ngModelChange)="applyFilter()">
            <mat-option [value]="null">All statuses</mat-option>
            @for (s of allStatuses; track s) {
              <mat-option [value]="s">{{ statusLabel(s) }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline" class="filter-field">
          <mat-label>Category</mat-label>
          <mat-select [(ngModel)]="filterCategory" (ngModelChange)="applyFilter()">
            <mat-option [value]="null">All categories</mat-option>
            <mat-option value="bug">Bug</mat-option>
            <mat-option value="feature_request">Feature Request</mat-option>
            <mat-option value="comment">Comment</mat-option>
          </mat-select>
        </mat-form-field>
      </div>

      @if (loading()) {
        <div class="center"><mat-spinner /></div>
      } @else if (filtered().length === 0) {
        <p class="empty">No feedback found.</p>
      } @else {
        <div class="feedback-list">
          @for (item of filtered(); track item.id) {
            <mat-card class="feedback-card" [class.expanded]="expandedId() === item.id">
              <mat-card-content>

                <!-- Top row: badges + meta -->
                <div class="card-top">
                  <div class="badges">
                    <span class="category-chip" [style.background]="categoryColor(item.category) + '22'" [style.color]="categoryColor(item.category)">
                      {{ categoryLabel(item.category) }}
                    </span>
                    <span class="status-chip" [style.background]="statusColor(item.status) + '22'" [style.color]="statusColor(item.status)">
                      {{ statusLabel(item.status) }}
                    </span>
                  </div>
                  <div class="meta">
                    <span class="submitter">{{ item.user.fullName }}</span>
                    <span class="dot">&middot;</span>
                    <span class="date">{{ item.createdAt | date: 'MMM d, y' }}</span>
                  </div>
                </div>

                <!-- Body -->
                <p class="body-text" [class.truncated]="expandedId() !== item.id">{{ item.body }}</p>
                @if (item.body.length > 200) {
                  <button mat-button class="expand-btn" (click)="toggleExpand(item.id)">
                    {{ expandedId() === item.id ? 'Show less' : 'Show more' }}
                  </button>
                }

                <!-- Admin note (if set) -->
                @if (item.adminNote) {
                  <div class="admin-note-display">
                    <mat-icon class="note-icon">sticky_note_2</mat-icon>
                    <span>{{ item.adminNote }}</span>
                  </div>
                }

                <!-- Actions -->
                <div class="card-actions">
                  <mat-form-field appearance="outline" class="status-field">
                    <mat-label>Status</mat-label>
                    <mat-select [value]="item.status" (selectionChange)="updateStatus(item, $event.value)">
                      @for (s of allStatuses; track s) {
                        <mat-option [value]="s">{{ statusLabel(s) }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>

                  <button mat-stroked-button (click)="openNoteEditor(item)" matTooltip="Add or edit admin note">
                    <mat-icon>edit_note</mat-icon>
                    {{ item.adminNote ? 'Edit note' : 'Add note' }}
                  </button>
                </div>

                <!-- Inline note editor -->
                @if (editingNoteId() === item.id) {
                  <div class="note-editor">
                    <mat-form-field appearance="outline" class="note-field">
                      <mat-label>Admin note (internal)</mat-label>
                      <textarea matInput [(ngModel)]="noteText" rows="3"></textarea>
                    </mat-form-field>
                    <div class="note-actions">
                      <button mat-button (click)="cancelNote()">Cancel</button>
                      <button mat-raised-button color="primary" (click)="saveNote(item)" [disabled]="savingId() === item.id">
                        @if (savingId() === item.id) { <mat-spinner diameter="16" /> }
                        @else { Save note }
                      </button>
                    </div>
                  </div>
                }

              </mat-card-content>
            </mat-card>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .feedback-admin { max-width: 860px; margin: 0 auto; padding: 24px 16px; }
    .page-header {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 20px;
      h1 { margin: 0; font-size: 1.75rem; color: var(--db-brown-dark); }
    }
    .item-count { font-size: 0.9rem; color: #888; }
    .filters { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
    .filter-field { width: 200px; margin-bottom: -1.25em; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty { text-align: center; color: #999; padding: 48px 0; }

    .feedback-list { display: flex; flex-direction: column; gap: 16px; }

    .feedback-card { border-radius: 10px; }

    .card-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 10px;
    }
    .badges { display: flex; gap: 8px; flex-wrap: wrap; }
    .category-chip, .status-chip {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .meta { display: flex; align-items: center; gap: 6px; font-size: 0.82rem; color: #888; }
    .submitter { font-weight: 600; color: #555; }
    .dot { color: #ccc; }

    .body-text {
      font-size: 0.92rem;
      color: #333;
      line-height: 1.55;
      margin: 0 0 4px;
      white-space: pre-wrap;
      word-break: break-word;
      &.truncated {
        display: -webkit-box;
        -webkit-line-clamp: 4;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
    }
    .expand-btn { font-size: 0.78rem; padding: 0; min-width: 0; height: auto; margin-bottom: 8px; }

    .admin-note-display {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      background: #fff8e1;
      border-left: 3px solid #f9a825;
      border-radius: 0 6px 6px 0;
      padding: 8px 12px;
      margin: 8px 0;
      font-size: 0.85rem;
      color: #5d4037;
      .note-icon { font-size: 1rem; width: 1rem; height: 1rem; color: #f9a825; flex-shrink: 0; margin-top: 1px; }
    }

    .card-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .status-field { width: 180px; margin-bottom: -1.25em; }

    .note-editor { margin-top: 12px; }
    .note-field { width: 100%; }
    .note-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
  `],
})
export class AdminFeedbackComponent implements OnInit {
  private readonly feedbackService = inject(FeedbackService);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(true);
  readonly savingId = signal<number | null>(null);
  readonly expandedId = signal<number | null>(null);
  readonly editingNoteId = signal<number | null>(null);

  readonly items = signal<FeedbackItem[]>([]);
  readonly filtered = signal<FeedbackItem[]>([]);

  filterStatus: FeedbackStatus | null = null;
  filterCategory: string | null = null;
  noteText = '';

  readonly allStatuses: FeedbackStatus[] = [
    'new', 'under_review', 'in_progress', 'released', 'wont_do', 'duplicate',
  ];

  statusLabel(s: FeedbackStatus): string { return STATUS_LABELS[s]; }
  statusColor(s: FeedbackStatus): string { return STATUS_COLORS[s]; }
  categoryLabel(c: string): string { return CATEGORY_LABELS[c] ?? c; }
  categoryColor(c: string): string { return CATEGORY_COLORS[c] ?? '#555'; }

  ngOnInit(): void {
    this.feedbackService.getAll().subscribe({
      next: (data) => {
        this.items.set(data);
        this.applyFilter();
        this.loading.set(false);
        if (data.some((i) => !i.seenAt)) {
          this.feedbackService.markAllSeen().subscribe();
        }
      },
      error: () => this.loading.set(false),
    });
  }

  applyFilter(): void {
    let result = this.items();
    if (this.filterStatus) result = result.filter((i) => i.status === this.filterStatus);
    if (this.filterCategory) result = result.filter((i) => i.category === this.filterCategory);
    this.filtered.set(result);
  }

  toggleExpand(id: number): void {
    const isOpening = this.expandedId() !== id;
    this.expandedId.set(isOpening ? id : null);

    if (isOpening) {
      const item = this.items().find((i) => i.id === id);
      if (item && !item.seenAt) {
        this.feedbackService.markSeen(id).subscribe({
          next: (updated) => this.patchItem(updated),
          error: () => {},
        });
      }
    }
  }

  updateStatus(item: FeedbackItem, status: FeedbackStatus): void {
    this.savingId.set(item.id);
    this.feedbackService.update(item.id, { status }).subscribe({
      next: (updated) => {
        this.patchItem(updated);
        this.savingId.set(null);
        this.snackBar.open('Status updated', 'OK', { duration: 2000 });
      },
      error: () => {
        this.savingId.set(null);
        this.snackBar.open('Failed to update status', 'OK', { duration: 3000 });
      },
    });
  }

  openNoteEditor(item: FeedbackItem): void {
    this.editingNoteId.set(item.id);
    this.noteText = item.adminNote ?? '';
  }

  cancelNote(): void {
    this.editingNoteId.set(null);
    this.noteText = '';
  }

  saveNote(item: FeedbackItem): void {
    this.savingId.set(item.id);
    const adminNote = this.noteText.trim() || null;
    this.feedbackService.update(item.id, { adminNote }).subscribe({
      next: (updated) => {
        this.patchItem(updated);
        this.savingId.set(null);
        this.editingNoteId.set(null);
        this.noteText = '';
        this.snackBar.open('Note saved', 'OK', { duration: 2000 });
      },
      error: () => {
        this.savingId.set(null);
        this.snackBar.open('Failed to save note', 'OK', { duration: 3000 });
      },
    });
  }

  private patchItem(updated: FeedbackItem): void {
    this.items.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
    this.applyFilter();
  }
}
