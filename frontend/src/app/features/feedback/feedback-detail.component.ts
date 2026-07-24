import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { QuillModule } from 'ngx-quill';
import { AuthService } from '../../core/services/auth.service';
import {
  FeedbackService,
  FeedbackItem,
  FeedbackNote,
  STATUS_LABELS,
  STATUS_COLORS,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
} from '../../core/services/feedback.service';
import { ReleasesService, Release } from '../../core/services/releases.service';
import { normalizeNbsp } from '../../shared/utils/normalize-nbsp';

@Component({
  selector: 'app-feedback-detail',
  standalone: true,
  imports: [
    RouterLink,
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatTooltipModule,
    QuillModule,
  ],
  template: `
    <div class="detail-page">
      <div class="back-nav">
        <button mat-button routerLink="/feedback">
          <mat-icon>arrow_back</mat-icon> Back to board
        </button>
      </div>

      @if (loading()) {
        <div class="center"><mat-spinner /></div>
      } @else if (item()) {
        <div class="detail-card">
          <!-- Header -->
          <div class="item-header">
            <div class="badges">
              <span
                class="category-chip"
                [style.background]="catColor(item()!.category) + '22'"
                [style.color]="catColor(item()!.category)"
              >
                {{ catLabel(item()!.category) }}
              </span>
              <span
                class="status-chip"
                [style.background]="statusColor(item()!.status) + '22'"
                [style.color]="statusColor(item()!.status)"
              >
                {{ statusLabel(item()!.status) }}
              </span>
              @if (item()!.isPrivate) {
                <mat-icon class="private-icon" matTooltip="Private ticket">lock</mat-icon>
              }
            </div>
            <h1 class="item-title">{{ item()!.title ?? '(no title)' }}</h1>
            <div class="item-meta">
              <span>{{ item()!.user?.fullName }}</span>
              <span class="dot">&middot;</span>
              <span>{{ item()!.createdAt | date: 'MMMM d, y' }}</span>
            </div>
          </div>

          <!-- Shipped banner -->
          @if (item()!.status === 'shipped' && shippedRelease()) {
            <div class="shipped-banner">
              <mat-icon>rocket_launch</mat-icon>
              Shipped in
              <a [routerLink]="['/updates']" class="release-link"
                >v{{ shippedRelease()!.version }}</a
              >
              — {{ shippedRelease()!.title }}
            </div>
          }

          <!-- Upvote -->
          <div class="upvote-section">
            <button
              class="upvote-btn"
              [class.upvoted]="item()!.hasUpvoted"
              (click)="toggleUpvote()"
              [matTooltip]="item()!.hasUpvoted ? 'Remove upvote' : 'Upvote this'"
            >
              <mat-icon>arrow_upward</mat-icon>
              <span>{{ item()!.upvoteCount }}</span>
              <span class="upvote-label">{{ item()!.hasUpvoted ? 'Upvoted' : 'Upvote' }}</span>
            </button>
          </div>

          <!-- Body -->
          <div class="item-body" [innerHTML]="safeBody()"></div>

          <!-- Notes thread -->
          <div class="notes-section">
            <h3>Discussion</h3>

            @if (notes().length === 0) {
              <p class="no-notes">No notes yet. Be the first to add one.</p>
            } @else {
              <div class="notes-list">
                @for (note of notes(); track note.id) {
                  <div class="note-item" [class.admin-only]="note.isAdminOnly">
                    <div class="note-header">
                      <span class="note-author">{{ note.author.fullName }}</span>
                      @if (note.isAdminOnly) {
                        <span class="admin-badge">Admin only</span>
                      }
                      <span class="note-date">{{ note.createdAt | date: 'MMM d, y, h:mm a' }}</span>
                    </div>
                    <div class="note-body" [innerHTML]="safeHtml(note.content)"></div>
                  </div>
                }
              </div>
            }

            <!-- Add note form -->
            <form [formGroup]="noteForm" (ngSubmit)="addNote()" class="note-form">
              <div class="quill-wrapper">
                <quill-editor
                  formControlName="content"
                  placeholder="Add a note…"
                  [modules]="quillModules"
                  class="note-quill"
                ></quill-editor>
              </div>
              @if (isAdminOrMod()) {
                <mat-slide-toggle formControlName="isAdminOnly" color="warn" class="admin-toggle">
                  Admin-only note
                </mat-slide-toggle>
              }
              <div class="note-actions">
                <button mat-raised-button color="primary" type="submit" [disabled]="savingNote()">
                  @if (savingNote()) {
                    <mat-spinner diameter="16" />
                  } @else {
                    Post note
                  }
                </button>
              </div>
            </form>
          </div>
        </div>
      } @else {
        <p class="not-found">Ticket not found.</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .detail-page {
        max-width: 760px;
        margin: 0 auto;
        padding: 16px;
      }
      .back-nav {
        margin-bottom: 12px;
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .not-found {
        text-align: center;
        color: #999;
        padding: 48px;
      }

      .detail-card {
        background: white;
        border-radius: 12px;
        padding: 28px;
        box-shadow: 0 2px 12px rgba(61, 28, 5, 0.08);
      }

      .item-header {
        margin-bottom: 16px;
      }
      .badges {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
        flex-wrap: wrap;
      }
      .category-chip,
      .status-chip {
        font-size: 0.72rem;
        font-weight: 700;
        padding: 3px 10px;
        border-radius: 12px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .private-icon {
        font-size: 0.9rem;
        width: 0.9rem;
        height: 0.9rem;
        color: #aaa;
      }
      .item-title {
        margin: 0 0 8px;
        font-size: 1.5rem;
        color: var(--db-brown-dark);
        line-height: 1.3;
      }
      .item-meta {
        font-size: 0.85rem;
        color: #888;
        display: flex;
        gap: 6px;
      }
      .dot {
        color: #ccc;
      }

      .shipped-banner {
        display: flex;
        align-items: center;
        gap: 8px;
        background: #e8f5e9;
        border-left: 4px solid #2e7d32;
        border-radius: 0 8px 8px 0;
        padding: 10px 14px;
        margin-bottom: 20px;
        font-size: 0.9rem;
        color: #1b5e20;
        mat-icon {
          color: #2e7d32;
        }
        .release-link {
          color: #2e7d32;
          font-weight: 700;
          text-decoration: underline;
        }
      }

      .upvote-section {
        margin-bottom: 20px;
      }
      .upvote-btn {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: #f5f5f5;
        border: 1px solid #e0e0e0;
        border-radius: 24px;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: 600;
        color: #555;
        transition: all 0.15s;
        mat-icon {
          font-size: 1.1rem;
          width: 1.1rem;
          height: 1.1rem;
        }
        .upvote-label {
          font-size: 0.85rem;
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

      .item-body {
        font-size: 0.95rem;
        line-height: 1.65;
        color: #333;
        margin-bottom: 28px;
        ::ng-deep p {
          margin: 0 0 10px;
        }
        ::ng-deep ul,
        ::ng-deep ol {
          padding-left: 20px;
          margin: 0 0 10px;
        }
      }

      .notes-section {
        border-top: 1px solid #eee;
        padding-top: 20px;
        h3 {
          margin: 0 0 16px;
          font-size: 1.05rem;
          color: #444;
        }
      }
      .no-notes {
        color: #aaa;
        font-size: 0.9rem;
        margin: 0 0 20px;
      }

      .notes-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 24px;
      }
      .note-item {
        background: #fafafa;
        border: 1px solid #eee;
        border-radius: 8px;
        padding: 12px 14px;
        &.admin-only {
          background: #fff8e1;
          border-color: #ffe082;
        }
      }
      .note-header {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 8px;
      }
      .note-author {
        font-size: 0.85rem;
        font-weight: 600;
        color: #333;
      }
      .admin-badge {
        font-size: 0.7rem;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 10px;
        background: #ffe082;
        color: #5d4037;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .note-date {
        font-size: 0.75rem;
        color: #aaa;
        margin-left: auto;
      }
      .note-body {
        font-size: 0.88rem;
        line-height: 1.55;
        color: #444;
        ::ng-deep p {
          margin: 0;
        }
      }

      .note-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .quill-wrapper {
        border: 1px solid rgba(0, 0, 0, 0.23);
        border-radius: 4px;
        &:focus-within {
          border-color: var(--db-primary);
          border-width: 2px;
        }
      }
      .note-quill {
        display: block;
      }
      ::ng-deep .note-quill .ql-container {
        border: none;
        font-size: 0.9rem;
        min-height: 90px;
      }
      ::ng-deep .note-quill .ql-toolbar {
        border: none;
        border-bottom: 1px solid rgba(0, 0, 0, 0.12);
      }
      .admin-toggle {
        font-size: 0.85rem;
      }
      .note-actions {
        display: flex;
        justify-content: flex-end;
      }
    `,
  ],
})
export class FeedbackDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly feedbackService = inject(FeedbackService);
  private readonly releasesService = inject(ReleasesService);
  private readonly authService = inject(AuthService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly loading = signal(true);
  readonly savingNote = signal(false);
  readonly item = signal<FeedbackItem | null>(null);
  readonly notes = signal<FeedbackNote[]>([]);
  readonly shippedRelease = signal<Release | null>(null);

  readonly quillModules = {
    toolbar: [['bold', 'italic'], [{ list: 'bullet' }], ['link'], ['clean']],
  };

  readonly noteForm = this.fb.group({
    content: ['', [Validators.required, Validators.minLength(1)]],
    isAdminOnly: [false],
  });

  get isAdminOrMod(): () => boolean {
    return () => {
      const role = this.authService.currentUser()?.role;
      return role === 'admin' || role === 'moderator';
    };
  }

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.feedbackService.getOne(id).subscribe({
      next: (item) => {
        this.item.set(item);
        this.loading.set(false);
        if (item.status === 'shipped') this.loadShippedRelease(item.id);
      },
      error: () => this.loading.set(false),
    });
    this.feedbackService.getNotes(id).subscribe({
      next: (notes) => this.notes.set(notes),
      error: () => {},
    });
  }

  private loadShippedRelease(feedbackId: number): void {
    this.releasesService.getPublished().subscribe({
      next: (releases) => {
        const match = releases.find((r) => r.linkedFeedback?.some((fb) => fb.id === feedbackId));
        if (match) this.shippedRelease.set(match);
      },
      error: () => {},
    });
  }

  safeBody(): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(normalizeNbsp(this.item()?.body ?? ''));
  }

  safeHtml(content: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(normalizeNbsp(content));
  }

  toggleUpvote(): void {
    const current = this.item();
    if (!current) return;
    this.feedbackService.toggleUpvote(current.id).subscribe({
      next: ({ upvoteCount, hasUpvoted }) => {
        this.item.update((i) => (i ? { ...i, upvoteCount, hasUpvoted } : i));
      },
      error: () => this.snackBar.open('Failed to update upvote', 'OK', { duration: 3000 }),
    });
  }

  addNote(): void {
    const rawContent = this.noteForm.controls.content.value.replace(/<[^>]*>/g, '').trim();
    if (!rawContent) {
      this.noteForm.markAllAsTouched();
      return;
    }
    if (this.noteForm.controls.content.value.includes('<img')) {
      this.snackBar.open('Images are not supported — please describe in text instead.', 'OK', {
        duration: 5000,
      });
      return;
    }

    this.savingNote.set(true);
    const val = this.noteForm.getRawValue();
    const current = this.item();
    if (!current) return;

    this.feedbackService
      .addNote(current.id, {
        content: normalizeNbsp(val.content),
        isAdminOnly: val.isAdminOnly,
      })
      .subscribe({
        next: (note) => {
          this.notes.update((list) => [...list, note]);
          this.savingNote.set(false);
          this.noteForm.reset({ content: '', isAdminOnly: false });
        },
        error: () => {
          this.savingNote.set(false);
          this.snackBar.open('Failed to post note', 'OK', { duration: 3000 });
        },
      });
  }

  statusLabel(s: string): string {
    return STATUS_LABELS[s as keyof typeof STATUS_LABELS] ?? s;
  }
  statusColor(s: string): string {
    return STATUS_COLORS[s as keyof typeof STATUS_COLORS] ?? '#555';
  }
  catLabel(c: string): string {
    return CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] ?? c;
  }
  catColor(c: string): string {
    return CATEGORY_COLORS[c as keyof typeof CATEGORY_COLORS] ?? '#555';
  }
}
