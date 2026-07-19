import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { QuillModule } from 'ngx-quill';
import { ReleasesService, Release } from '../../../core/services/releases.service';
import { normalizeNbsp } from '../../../shared/utils/normalize-nbsp';
import { FeedbackItem, CATEGORY_LABELS } from '../../../core/services/feedback.service';

@Component({
  selector: 'app-admin-releases',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    QuillModule,
  ],
  template: `
    <div class="releases-page">
      <div class="page-header">
        <button mat-button routerLink="/admin/feedback">
          <mat-icon>arrow_back</mat-icon> Feedback
        </button>
        <h1>Releases</h1>
      </div>

      <div class="layout">
        <!-- Create / Edit form -->
        <section class="create-panel">
          <div class="panel-header">
            <h2>{{ editingId() ? 'Edit Draft' : 'New Release' }}</h2>
            @if (editingId()) {
              <button mat-button type="button" (click)="cancelEdit()">
                <mat-icon>add</mat-icon> New release
              </button>
            }
          </div>
          <form [formGroup]="form" (ngSubmit)="save()" class="release-form">
            <mat-form-field appearance="outline">
              <mat-label>Version</mat-label>
              <input matInput formControlName="version" placeholder="e.g. 1.2.0" />
              <mat-error>
                @if (form.controls.version.hasError('pattern')) {
                  Must be valid semver (e.g. 1.2.0)
                } @else {
                  Version is required
                }
              </mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Title</mat-label>
              <input
                matInput
                formControlName="title"
                placeholder="Brief release headline"
                maxlength="200"
              />
              <mat-error>Title is required</mat-error>
            </mat-form-field>

            <div class="quill-wrapper">
              <label class="quill-label">Release Notes</label>
              <quill-editor
                formControlName="body"
                placeholder="What changed in this release…"
                [modules]="quillModules"
                class="release-quill"
              ></quill-editor>
            </div>

            <!-- Link resolved feedback -->
            <div class="feedback-linker">
              <div class="linker-header">
                <h3>Link Resolved Feedback</h3>
                @if (linkedIds().size > 0) {
                  <button
                    mat-button
                    type="button"
                    class="refresh-btn"
                    (click)="refreshNotes()"
                    matTooltip="Overwrite notes with bullet list from linked items"
                  >
                    <mat-icon>refresh</mat-icon> Refresh notes
                  </button>
                }
              </div>
              @if (loadingFeedback()) {
                <mat-spinner diameter="20" />
              } @else if (resolvedFeedback().length === 0) {
                <p class="empty-resolved">No resolved feedback tickets available.</p>
              } @else {
                <div class="feedback-checkboxes">
                  @for (fb of resolvedFeedback(); track fb.id) {
                    <label class="fb-checkbox-row" [class.checked]="isLinked(fb.id)">
                      <input
                        type="checkbox"
                        [checked]="isLinked(fb.id)"
                        (change)="toggleLink(fb.id)"
                      />
                      <span class="fb-row-content">
                        <span class="fb-cat" [style.color]="catColor(fb.category)">{{
                          catLabel(fb.category)
                        }}</span>
                        <span class="fb-title">{{ fb.title ?? '(no title)' }}</span>
                        <span class="fb-user">— {{ fb.user?.fullName ?? 'Unknown' }}</span>
                        @if (fb.isPrivate) {
                          <mat-icon class="lock-icon" matTooltip="Private">lock</mat-icon>
                        }
                        @if (fb.releaseNote) {
                          <span class="fb-release-note" matTooltip="Release note text"
                            >→ {{ fb.releaseNote }}</span
                          >
                        } @else {
                          <span class="fb-release-note missing">no release note</span>
                        }
                      </span>
                    </label>
                  }
                </div>
              }
            </div>

            <!-- Community credit preview -->
            @if (linkedIds().size > 0) {
              <div class="credit-preview">
                <mat-icon>people</mat-icon>
                <span>Credit: {{ creditPreview() }}</span>
              </div>
            }

            <div class="form-actions">
              <button mat-button type="button" routerLink="/admin/feedback">Cancel</button>
              <button mat-raised-button color="primary" type="submit" [disabled]="saving()">
                @if (saving()) {
                  <mat-spinner diameter="18" />
                } @else {
                  {{ editingId() ? 'Update Draft' : 'Save Draft' }}
                }
              </button>
            </div>
          </form>
        </section>

        <!-- Existing releases -->
        <section class="releases-panel">
          <h2>Published Releases</h2>
          @if (loadingReleases()) {
            <mat-spinner diameter="24" />
          } @else if (releases().length === 0) {
            <p class="empty-releases">No releases yet.</p>
          } @else {
            <div class="releases-list">
              @for (r of releases(); track r.id) {
                <div class="release-row" [class.draft]="!r.publishedAt">
                  <div class="release-row-header">
                    <span class="version-badge">v{{ r.version }}</span>
                    @if (r.publishedAt) {
                      <span class="pub-date">{{ r.publishedAt | date: 'MMM d, y' }}</span>
                      <button
                        mat-stroked-button
                        class="unpublish-btn"
                        (click)="unpublish(r)"
                        [disabled]="publishingId() === r.id"
                      >
                        @if (publishingId() === r.id) {
                          <mat-spinner diameter="14" />
                        } @else {
                          <ng-container><mat-icon>undo</mat-icon> Unpublish</ng-container>
                        }
                      </button>
                    } @else {
                      <span class="draft-badge">Draft</span>
                      <button
                        mat-stroked-button
                        class="edit-btn"
                        (click)="startEdit(r)"
                        [disabled]="editingId() === r.id"
                      >
                        <mat-icon>edit</mat-icon> Edit
                      </button>
                      <button
                        mat-stroked-button
                        class="publish-btn"
                        (click)="publish(r)"
                        [disabled]="publishingId() === r.id"
                      >
                        @if (publishingId() === r.id) {
                          <mat-spinner diameter="14" />
                        } @else {
                          <ng-container><mat-icon>rocket_launch</mat-icon> Publish</ng-container>
                        }
                      </button>
                    }
                  </div>
                  <div class="release-row-title">{{ r.title }}</div>
                </div>
              }
            </div>
          }
        </section>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .releases-page {
        max-width: 1000px;
        margin: 0 auto;
        padding: 24px 16px;
      }
      .page-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 24px;
        h1 {
          margin: 0;
          font-size: 1.75rem;
          color: var(--db-brown-dark);
        }
      }

      .layout {
        display: grid;
        grid-template-columns: 1fr 360px;
        gap: 24px;
        align-items: start;
      }
      @media (max-width: 768px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }

      .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
        h2 {
          margin: 0;
          font-size: 1.1rem;
          color: #444;
        }
      }
      h2 {
        margin: 0 0 20px;
        font-size: 1.1rem;
        color: #444;
      }

      .create-panel,
      .releases-panel {
        background: white;
        border-radius: 12px;
        padding: 24px;
        box-shadow: 0 2px 8px rgba(61, 28, 5, 0.07);
      }

      .release-form {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      mat-form-field {
        width: 100%;
      }

      .quill-wrapper {
        border: 1px solid rgba(0, 0, 0, 0.23);
        border-radius: 4px;
        &:focus-within {
          border-color: var(--db-blue, #1e4d8c);
          border-width: 2px;
        }
      }
      .quill-label {
        display: block;
        font-size: 0.75rem;
        color: rgba(0, 0, 0, 0.6);
        padding: 8px 12px 0;
      }
      .release-quill {
        display: block;
      }
      ::ng-deep .release-quill .ql-container {
        border: none;
        min-height: 180px;
        font-size: 0.95rem;
      }
      ::ng-deep .release-quill .ql-toolbar {
        border: none;
        border-bottom: 1px solid rgba(0, 0, 0, 0.12);
      }

      .feedback-linker {
        border: 1px solid #eee;
        border-radius: 8px;
        padding: 16px;
      }
      .linker-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }
      .feedback-linker h3 {
        margin: 0;
        font-size: 0.9rem;
        color: #555;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .refresh-btn {
        font-size: 0.8rem;
        color: #888;
        mat-icon {
          font-size: 0.9rem;
          width: 0.9rem;
          height: 0.9rem;
        }
      }
      .empty-resolved {
        font-size: 0.85rem;
        color: #aaa;
        margin: 0;
      }
      .feedback-checkboxes {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 260px;
        overflow-y: auto;
      }
      .fb-checkbox-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 8px 10px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.1s;
        &:hover {
          background: #f5f5f5;
        }
        &.checked {
          background: #e3f2fd;
        }
        input {
          margin-top: 2px;
          flex-shrink: 0;
          cursor: pointer;
        }
      }
      .fb-row-content {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
        font-size: 0.85rem;
      }
      .fb-cat {
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .fb-title {
        color: #333;
      }
      .fb-user {
        color: #aaa;
        font-size: 0.8rem;
      }
      .lock-icon {
        font-size: 0.8rem;
        width: 0.8rem;
        height: 0.8rem;
        color: #aaa;
      }
      .fb-release-note {
        font-size: 0.78rem;
        color: #1565c0;
        font-style: italic;
        &.missing {
          color: #ccc;
        }
      }

      .credit-preview {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        background: #f3f8ff;
        border-radius: 8px;
        padding: 10px 14px;
        font-size: 0.85rem;
        color: #555;
        mat-icon {
          font-size: 1rem;
          width: 1rem;
          height: 1rem;
          color: var(--db-blue, #1e4d8c);
          flex-shrink: 0;
          margin-top: 1px;
        }
      }

      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }

      .releases-list {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .release-row {
        border: 1px solid #eee;
        border-radius: 8px;
        padding: 12px 14px;
        &.draft {
          border-color: #ffe082;
          background: #fffde7;
        }
      }
      .release-row-header {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        margin-bottom: 4px;
      }
      .version-badge {
        font-size: 0.75rem;
        font-weight: 800;
        padding: 2px 8px;
        border-radius: 10px;
        background: var(--db-blue, #1e4d8c);
        color: white;
      }
      .pub-date {
        font-size: 0.8rem;
        color: #aaa;
      }
      .draft-badge {
        font-size: 0.7rem;
        font-weight: 700;
        padding: 2px 7px;
        border-radius: 8px;
        background: #ffe082;
        color: #5d4037;
        text-transform: uppercase;
      }
      .edit-btn,
      .publish-btn,
      .unpublish-btn {
        height: 28px;
        font-size: 0.8rem;
        mat-icon {
          font-size: 0.9rem;
          width: 0.9rem;
          height: 0.9rem;
        }
      }
      .release-row-title {
        font-size: 0.9rem;
        font-weight: 600;
        color: #333;
      }
      .empty-releases {
        font-size: 0.85rem;
        color: #aaa;
        margin: 0;
      }
    `,
  ],
})
export class AdminReleasesComponent implements OnInit {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly releasesService = inject(ReleasesService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly saving = signal(false);
  readonly loadingFeedback = signal(true);
  readonly loadingReleases = signal(true);
  readonly publishingId = signal<number | null>(null);
  readonly editingId = signal<number | null>(null);
  readonly resolvedFeedback = signal<FeedbackItem[]>([]);
  readonly releases = signal<Release[]>([]);
  readonly linkedIds = signal<Set<number>>(new Set());

  readonly quillModules = {
    toolbar: [
      ['bold', 'italic', 'underline'],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ header: [2, 3, false] }],
      ['link'],
      ['clean'],
    ],
  };

  readonly form = this.fb.group({
    version: ['', [Validators.required, Validators.pattern(/^\d+\.\d+\.\d+$/)]],
    title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(200)]],
    body: ['', [Validators.required, Validators.minLength(10)]],
  });

  ngOnInit(): void {
    this.releasesService.getResolvedFeedback().subscribe({
      next: (data) => {
        this.resolvedFeedback.set(data);
        this.loadingFeedback.set(false);
      },
      error: () => this.loadingFeedback.set(false),
    });
    this.releasesService.getAll().subscribe({
      next: (data) => {
        this.releases.set(data);
        this.loadingReleases.set(false);
      },
      error: () => this.loadingReleases.set(false),
    });
  }

  private lastAutoBody = '';

  isLinked(id: number): boolean {
    return this.linkedIds().has(id);
  }

  toggleLink(id: number): void {
    const bodyBeforeChange = this.generateBody();
    this.linkedIds.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    const currentBody = this.form.controls.body.value;
    if (!currentBody || currentBody === bodyBeforeChange || currentBody === this.lastAutoBody) {
      this.refreshNotes();
    }
  }

  refreshNotes(): void {
    const body = this.generateBody();
    this.lastAutoBody = body;
    this.form.controls.body.setValue(body);
  }

  private generateBody(): string {
    const linked = this.resolvedFeedback().filter(
      (fb) => this.linkedIds().has(fb.id) && (fb.releaseNote || fb.title),
    );
    if (linked.length === 0) return '';
    return '<ul>' + linked.map((fb) => `<li>${fb.releaseNote ?? fb.title}</li>`).join('') + '</ul>';
  }

  creditPreview(): string {
    const linked = this.resolvedFeedback().filter((fb) => this.linkedIds().has(fb.id));
    const names = linked.map((fb) =>
      fb.isPrivate ? 'a community member' : (fb.user?.fullName ?? 'Unknown'),
    );
    const unique = [...new Set(names)];
    if (unique.length === 0) return '';
    if (unique.length === 1) return unique[0];
    if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
    return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
  }

  catLabel(c: string): string {
    return CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS] ?? c;
  }
  catColor(c: string): string {
    const map: Record<string, string> = {
      bug: '#c62828',
      feature_request: '#1565c0',
      comment: '#555',
    };
    return map[c] ?? '#555';
  }

  startEdit(release: Release): void {
    this.editingId.set(release.id);
    this.form.setValue({
      version: release.version,
      title: release.title,
      body: release.body,
    });
    const ids = new Set((release.linkedFeedback ?? []).map((fb) => fb.id));
    this.linkedIds.set(ids);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.form.reset();
    this.linkedIds.set(new Set());
  }

  save(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.saving.set(true);
    const val = this.form.getRawValue();
    const payload = {
      version: val.version.trim(),
      title: val.title.trim(),
      body: normalizeNbsp(val.body),
      feedbackIds: [...this.linkedIds()],
    };

    const editId = this.editingId();
    const req$ = editId
      ? this.releasesService.update(editId, payload)
      : this.releasesService.create(payload);

    req$.subscribe({
      next: (release) => {
        this.releases.update((list) =>
          editId ? list.map((r) => (r.id === release.id ? release : r)) : [release, ...list],
        );
        this.saving.set(false);
        this.editingId.set(null);
        this.form.reset();
        this.linkedIds.set(new Set());
        const verb = editId ? 'updated' : 'saved as draft';
        this.snackBar.open(`Release v${release.version} ${verb}`, 'OK', { duration: 3000 });
      },
      error: (err) => {
        this.saving.set(false);
        const msg =
          err?.error?.message ?? (editId ? 'Failed to update release' : 'Failed to create release');
        this.snackBar.open(msg, 'OK', { duration: 4000 });
      },
    });
  }

  publish(release: Release): void {
    this.publishingId.set(release.id);
    this.releasesService.publish(release.id).subscribe({
      next: (updated) => {
        this.releases.update((list) => list.map((r) => (r.id === updated.id ? updated : r)));
        this.publishingId.set(null);
        this.snackBar
          .open(`v${updated.version} published!`, 'View', { duration: 4000 })
          .onAction()
          .subscribe(() => void this.router.navigate(['/updates']));
      },
      error: () => {
        this.publishingId.set(null);
        this.snackBar.open('Failed to publish release', 'OK', { duration: 3000 });
      },
    });
  }

  unpublish(release: Release): void {
    this.publishingId.set(release.id);
    this.releasesService.unpublish(release.id).subscribe({
      next: (updated) => {
        this.releases.update((list) => list.map((r) => (r.id === updated.id ? updated : r)));
        this.publishingId.set(null);
        this.snackBar.open(`v${updated.version} moved back to draft`, 'OK', { duration: 3000 });
      },
      error: () => {
        this.publishingId.set(null);
        this.snackBar.open('Failed to unpublish release', 'OK', { duration: 3000 });
      },
    });
  }
}
