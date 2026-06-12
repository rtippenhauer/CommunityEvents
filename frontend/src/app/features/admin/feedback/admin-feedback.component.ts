import { Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { QuillModule } from 'ngx-quill';
import {
  FeedbackService,
  FeedbackItem,
  FeedbackStatus,
  FeedbackNote,
  STATUS_LABELS,
  STATUS_COLORS,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
} from '../../../core/services/feedback.service';

@Component({
  selector: 'app-admin-feedback',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatTooltipModule,
    QuillModule,
  ],
  template: `
    <div class="feedback-admin">
      <div class="page-header">
        <h1>Feedback</h1>
        <div class="header-actions">
          <span class="item-count">{{ filtered().length }} item{{ filtered().length === 1 ? '' : 's' }}</span>
          <button mat-stroked-button routerLink="/admin/releases/new">
            <mat-icon>rocket_launch</mat-icon> New Release
          </button>
        </div>
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

                <!-- Top row -->
                <div class="card-top">
                  <div class="badges">
                    <span class="category-chip" [style.background]="categoryColor(item.category) + '22'" [style.color]="categoryColor(item.category)">
                      {{ categoryLabel(item.category) }}
                    </span>
                    <span class="status-chip" [style.background]="statusColor(item.status) + '22'" [style.color]="statusColor(item.status)">
                      {{ statusLabel(item.status) }}
                    </span>
                    @if (item.isPrivate) {
                      <mat-icon class="private-icon" matTooltip="Private ticket">lock</mat-icon>
                    }
                    @if (!item.seenAt) {
                      <span class="new-badge">New</span>
                    }
                  </div>
                  <div class="meta">
                    <span class="submitter">{{ item.user.fullName }}</span>
                    <span class="dot">&middot;</span>
                    <span class="date">{{ item.createdAt | date: 'MMM d, y' }}</span>
                    <span class="dot">&middot;</span>
                    <mat-icon class="upvote-meta-icon" matTooltip="Upvotes">arrow_upward</mat-icon>
                    <span>{{ item.upvoteCount }}</span>
                  </div>
                </div>

                <!-- Title + body -->
                @if (item.title) {
                  <div class="item-title">{{ item.title }}</div>
                }
                <div class="body-text" [class.truncated]="expandedId() !== item.id" [innerHTML]="safeHtml(item.body)"></div>
                <button mat-button class="expand-btn" (click)="toggleExpand(item.id)">
                  {{ expandedId() === item.id ? 'Show less' : 'Show more' }}
                </button>

                <!-- Actions row -->
                <div class="card-actions">
                  <mat-form-field appearance="outline" class="status-field">
                    <mat-label>Status</mat-label>
                    <mat-select [value]="item.status" (selectionChange)="updateStatus(item, $event.value)">
                      @for (s of allStatuses; track s) {
                        <mat-option [value]="s">{{ statusLabel(s) }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>

                  <button mat-stroked-button (click)="toggleNotePanel(item.id)" matTooltip="View / add notes">
                    <mat-icon>chat_bubble_outline</mat-icon>
                    Notes
                  </button>

                  <a mat-stroked-button [routerLink]="['/feedback', item.id]" matTooltip="View member view">
                    <mat-icon>open_in_new</mat-icon>
                  </a>
                </div>

                <!-- Notes panel -->
                @if (notePanelId() === item.id) {
                  <div class="notes-panel">
                    @if (loadingNotes()) {
                      <mat-spinner diameter="24" />
                    } @else {
                      @if (itemNotes().length === 0) {
                        <p class="no-notes">No notes yet.</p>
                      } @else {
                        @for (note of itemNotes(); track note.id) {
                          <div class="note-row" [class.admin-only]="note.isAdminOnly">
                            <span class="note-author">{{ note.author.fullName }}</span>
                            @if (note.isAdminOnly) { <span class="admin-badge">Admin only</span> }
                            <span class="note-date">{{ note.createdAt | date:'MMM d, h:mm a' }}</span>
                            <div class="note-body" [innerHTML]="safeHtml(note.content)"></div>
                          </div>
                        }
                      }
                      <!-- Add note -->
                      <div class="add-note-form">
                        <div class="quill-wrap">
                          <quill-editor
                            [(ngModel)]="newNoteContent"
                            placeholder="Add admin note…"
                            [modules]="quillModules"
                            class="note-quill"
                          ></quill-editor>
                        </div>
                        <div class="note-form-row">
                          <mat-slide-toggle [(ngModel)]="newNoteAdminOnly" color="warn">Admin only</mat-slide-toggle>
                          <button mat-raised-button color="primary" (click)="saveNote(item.id)" [disabled]="savingNote()">
                            @if (savingNote()) { <mat-spinner diameter="16" /> }
                            @else { Post note }
                          </button>
                        </div>
                      </div>
                    }
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
    .feedback-admin { max-width: 900px; margin: 0 auto; padding: 24px 16px; }
    .page-header {
      display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap;
      gap: 12px; margin-bottom: 20px;
      h1 { margin: 0; font-size: 1.75rem; color: var(--db-brown-dark); }
    }
    .header-actions { display: flex; align-items: center; gap: 12px; }
    .item-count { font-size: 0.9rem; color: #888; }
    .filters { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
    .filter-field { width: 200px; margin-bottom: -1.25em; }
    .center { display: flex; justify-content: center; padding: 48px; }
    .empty { text-align: center; color: #999; padding: 48px 0; }
    .feedback-list { display: flex; flex-direction: column; gap: 16px; }
    .feedback-card { border-radius: 10px; }

    .card-top {
      display: flex; align-items: flex-start; justify-content: space-between;
      flex-wrap: wrap; gap: 8px; margin-bottom: 10px;
    }
    .badges { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    .category-chip, .status-chip {
      font-size: 0.72rem; font-weight: 700; padding: 3px 10px; border-radius: 12px;
      text-transform: uppercase; letter-spacing: 0.05em;
    }
    .private-icon { font-size: 0.9rem; width: 0.9rem; height: 0.9rem; color: #aaa; }
    .new-badge {
      font-size: 0.68rem; font-weight: 800; padding: 2px 7px; border-radius: 10px;
      background: #e3f2fd; color: #1565c0; text-transform: uppercase; letter-spacing: 0.05em;
    }
    .meta { display: flex; align-items: center; gap: 6px; font-size: 0.82rem; color: #888; }
    .submitter { font-weight: 600; color: #555; }
    .dot { color: #ccc; }
    .upvote-meta-icon { font-size: 0.9rem; width: 0.9rem; height: 0.9rem; }

    .item-title { font-weight: 700; font-size: 0.95rem; color: #222; margin-bottom: 4px; }
    .body-text {
      font-size: 0.9rem; color: #444; line-height: 1.55; margin: 0 0 4px;
      &.truncated { max-height: 4.65em; overflow: hidden; }
      ::ng-deep p { margin: 0 0 8px; &:last-child { margin-bottom: 0; } }
    }
    .expand-btn { font-size: 0.78rem; padding: 0; min-width: 0; height: auto; margin-bottom: 8px; }

    .card-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
    .status-field { width: 180px; margin-bottom: -1.25em; }

    .notes-panel {
      margin-top: 16px;
      border-top: 1px solid #eee;
      padding-top: 16px;
    }
    .no-notes { font-size: 0.85rem; color: #aaa; margin: 0 0 12px; }
    .note-row {
      background: #fafafa; border: 1px solid #eee; border-radius: 6px;
      padding: 10px 12px; margin-bottom: 10px;
      &.admin-only { background: #fff8e1; border-color: #ffe082; }
    }
    .note-author { font-size: 0.82rem; font-weight: 600; color: #333; margin-right: 8px; }
    .admin-badge {
      font-size: 0.68rem; font-weight: 700; padding: 2px 6px; border-radius: 8px;
      background: #ffe082; color: #5d4037; text-transform: uppercase; margin-right: 8px;
    }
    .note-date { font-size: 0.75rem; color: #aaa; }
    .note-body { font-size: 0.85rem; color: #444; margin-top: 6px; line-height: 1.5; ::ng-deep p { margin: 0; } }

    .add-note-form { margin-top: 12px; }
    .quill-wrap {
      border: 1px solid rgba(0,0,0,0.23); border-radius: 4px; margin-bottom: 8px;
      &:focus-within { border-color: var(--db-blue, #1E4D8C); }
    }
    .note-quill { display: block; }
    ::ng-deep .note-quill .ql-container { border: none; min-height: 80px; font-size: 0.9rem; }
    ::ng-deep .note-quill .ql-toolbar { border: none; border-bottom: 1px solid rgba(0,0,0,0.12); }
    .note-form-row { display: flex; align-items: center; justify-content: space-between; }
  `],
})
export class AdminFeedbackComponent implements OnInit {
  private readonly feedbackService = inject(FeedbackService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly snackBar = inject(MatSnackBar);

  readonly loading = signal(true);
  readonly savingId = signal<number | null>(null);
  readonly savingNote = signal(false);
  readonly loadingNotes = signal(false);
  readonly expandedId = signal<number | null>(null);
  readonly notePanelId = signal<number | null>(null);
  readonly items = signal<FeedbackItem[]>([]);
  readonly filtered = signal<FeedbackItem[]>([]);
  readonly itemNotes = signal<FeedbackNote[]>([]);

  filterStatus: FeedbackStatus | null = null;
  filterCategory: string | null = null;
  newNoteContent = '';
  newNoteAdminOnly = false;

  readonly quillModules = {
    toolbar: [['bold', 'italic'], [{ list: 'bullet' }], ['link'], ['clean']],
  };

  readonly allStatuses: FeedbackStatus[] = ['open', 'in_progress', 'resolved', 'shipped', 'closed', 'wont_fix'];

  statusLabel(s: string): string { return STATUS_LABELS[s as FeedbackStatus] ?? s; }
  statusColor(s: string): string { return STATUS_COLORS[s as FeedbackStatus] ?? '#555'; }
  categoryLabel(c: string): string { return CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] ?? c; }
  categoryColor(c: string): string { return CATEGORY_COLORS[c as keyof typeof CATEGORY_COLORS] ?? '#555'; }
  safeHtml(html: string): SafeHtml { return this.sanitizer.bypassSecurityTrustHtml(html); }

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
    this.expandedId.set(this.expandedId() === id ? null : id);
  }

  toggleNotePanel(id: number): void {
    if (this.notePanelId() === id) {
      this.notePanelId.set(null);
      return;
    }
    this.notePanelId.set(id);
    this.itemNotes.set([]);
    this.loadingNotes.set(true);
    this.feedbackService.getNotes(id).subscribe({
      next: (notes) => { this.itemNotes.set(notes); this.loadingNotes.set(false); },
      error: () => this.loadingNotes.set(false),
    });
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

  saveNote(feedbackId: number): void {
    const raw = this.newNoteContent.replace(/<[^>]*>/g, '').trim();
    if (!raw) return;
    this.savingNote.set(true);
    this.feedbackService.addAdminNote(feedbackId, {
      content: this.newNoteContent,
      isAdminOnly: this.newNoteAdminOnly,
    }).subscribe({
      next: (note) => {
        this.itemNotes.update((list) => [...list, note]);
        this.newNoteContent = '';
        this.newNoteAdminOnly = false;
        this.savingNote.set(false);
        this.snackBar.open('Note posted', 'OK', { duration: 2000 });
      },
      error: () => {
        this.savingNote.set(false);
        this.snackBar.open('Failed to post note', 'OK', { duration: 3000 });
      },
    });
  }

  private patchItem(updated: FeedbackItem): void {
    this.items.update((list) => list.map((i) => (i.id === updated.id ? updated : i)));
    this.applyFilter();
  }
}
