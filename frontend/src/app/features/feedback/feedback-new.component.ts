import {
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { QuillModule } from 'ngx-quill';
import { FeedbackService, FeedbackCategory } from '../../core/services/feedback.service';
import { normalizeNbsp } from '../../shared/utils/normalize-nbsp';

@Component({
  selector: 'app-feedback-new',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatIconModule,
    QuillModule,
  ],
  template: `
    <div class="new-page">
      <div class="new-card">
        <div class="card-header">
          <button mat-icon-button routerLink="/feedback" class="back-btn">
            <mat-icon>arrow_back</mat-icon>
          </button>
          <h1>Submit Feedback</h1>
        </div>
        <p class="subtitle">
          Bug reports, feature ideas, or general comments — we read everything.
        </p>

        @if (submitted()) {
          <div class="success-state">
            <mat-icon class="success-icon">check_circle</mat-icon>
            <h2>Thanks for the feedback!</h2>
            <p>We'll review it and may reach out if we have questions.</p>
            <div class="success-actions">
              <button mat-stroked-button (click)="reset()">Submit more</button>
              <button mat-raised-button color="primary" routerLink="/feedback">View board</button>
            </div>
          </div>
        } @else {
          <form [formGroup]="form" (ngSubmit)="submit()" class="feedback-form">
            <mat-form-field appearance="outline">
              <mat-label>Type</mat-label>
              <mat-select formControlName="category">
                <mat-select-trigger>
                  @switch (form.controls.category.value) {
                    @case ('bug') {
                      <span class="opt-row"
                        ><mat-icon class="opt-icon bug-icon">bug_report</mat-icon> Bug Report</span
                      >
                    }
                    @case ('feature_request') {
                      <span class="opt-row"
                        ><mat-icon class="opt-icon feature-icon">lightbulb</mat-icon> Feature
                        Request</span
                      >
                    }
                    @case ('comment') {
                      <span class="opt-row"
                        ><mat-icon class="opt-icon comment-icon">chat_bubble_outline</mat-icon>
                        General Comment</span
                      >
                    }
                  }
                </mat-select-trigger>
                <mat-option value="bug">
                  <span class="opt-row"
                    ><mat-icon class="opt-icon bug-icon">bug_report</mat-icon> Bug Report</span
                  >
                </mat-option>
                <mat-option value="feature_request">
                  <span class="opt-row"
                    ><mat-icon class="opt-icon feature-icon">lightbulb</mat-icon> Feature
                    Request</span
                  >
                </mat-option>
                <mat-option value="comment">
                  <span class="opt-row"
                    ><mat-icon class="opt-icon comment-icon">chat_bubble_outline</mat-icon> General
                    Comment</span
                  >
                </mat-option>
              </mat-select>
              <mat-error>Please select a type</mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Title</mat-label>
              <input
                matInput
                formControlName="title"
                placeholder="Brief summary of the issue or idea"
                maxlength="200"
              />
              <mat-hint align="end">{{ form.controls.title.value.length }} / 200</mat-hint>
              <mat-error>
                @if (form.controls.title.hasError('minlength')) {
                  At least 3 characters required
                } @else {
                  Title is required
                }
              </mat-error>
            </mat-form-field>

            <div class="quill-wrapper" [class.quill-error]="showBodyError()">
              <label class="quill-label">Description</label>
              <quill-editor
                formControlName="body"
                placeholder="Describe the issue or idea in detail…"
                [modules]="quillModules"
                class="quill-editor"
                (onEditorCreated)="onEditorCreated($event)"
              ></quill-editor>
              @if (showBodyError()) {
                <div class="quill-err-msg">Description must be at least 10 characters</div>
              }
            </div>
            <input
              #imageInput
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              style="display:none"
              (change)="onImageFileSelected($event)"
            />

            <div class="private-toggle">
              <mat-slide-toggle formControlName="isPrivate" color="primary">
                Private — only you and admins can see this
              </mat-slide-toggle>
            </div>

            <div class="form-actions">
              <button mat-button type="button" routerLink="/feedback">Cancel</button>
              <button mat-raised-button color="primary" type="submit" [disabled]="saving()">
                @if (saving()) {
                  <mat-spinner diameter="18" />
                } @else {
                  Submit Feedback
                }
              </button>
            </div>
          </form>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .new-page {
        max-width: 680px;
        margin: 32px auto;
        padding: 0 16px;
      }
      .new-card {
        background: white;
        border-radius: 12px;
        padding: 32px;
        box-shadow: 0 2px 12px rgba(61, 28, 5, 0.1);
      }
      .card-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
        h1 {
          margin: 0;
          font-size: 1.5rem;
          color: var(--db-brown-dark);
        }
      }
      .back-btn {
        margin-left: -8px;
      }
      .subtitle {
        margin: 0 0 24px;
        font-size: 0.9rem;
        color: #666;
      }
      .feedback-form {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }
      mat-form-field {
        width: 100%;
      }
      .opt-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .opt-icon {
        font-size: 1.1rem;
        width: 1.1rem;
        height: 1.1rem;
      }
      .bug-icon {
        color: #c62828;
      }
      .feature-icon {
        color: #e65100;
      }
      .comment-icon {
        color: #1565c0;
      }

      .quill-wrapper {
        border: 1px solid rgba(0, 0, 0, 0.23);
        border-radius: 4px;
        padding: 0;
        transition: border-color 0.15s;
        &:focus-within {
          border-color: var(--db-blue, #1e4d8c);
          border-width: 2px;
        }
        &.quill-error {
          border-color: #f44336;
        }
      }
      .quill-label {
        display: block;
        font-size: 0.75rem;
        color: rgba(0, 0, 0, 0.6);
        padding: 8px 12px 0;
      }
      .quill-editor {
        display: block;
      }
      ::ng-deep .quill-editor .ql-container {
        border: none;
        font-size: 0.95rem;
        min-height: 160px;
      }
      ::ng-deep .quill-editor .ql-toolbar {
        border: none;
        border-bottom: 1px solid rgba(0, 0, 0, 0.12);
      }
      .quill-err-msg {
        font-size: 0.75rem;
        color: #f44336;
        padding: 4px 12px 8px;
      }

      .private-toggle {
        display: flex;
        align-items: center;
      }
      .form-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
      }

      .success-state {
        text-align: center;
        padding: 16px 0;
        .success-icon {
          font-size: 3.5rem;
          width: 3.5rem;
          height: 3.5rem;
          color: #2e7d32;
          margin-bottom: 12px;
        }
        h2 {
          margin: 0 0 8px;
          color: var(--db-brown-dark);
        }
        p {
          color: #666;
          margin: 0 0 24px;
        }
      }
      .success-actions {
        display: flex;
        justify-content: center;
        gap: 12px;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class FeedbackNewComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly feedbackService = inject(FeedbackService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  private readonly imageInput = viewChild<ElementRef<HTMLInputElement>>('imageInput');
  private quillInstance: any = null;

  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly showBodyError = signal(false);

  readonly quillModules = {
    toolbar: {
      container: [
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['link', 'image'],
        ['clean'],
      ],
      handlers: {
        image: () => this.imageInput()?.nativeElement.click(),
      },
    },
  };

  readonly form = this.fb.group({
    category: ['bug' as FeedbackCategory, Validators.required],
    title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(200)]],
    body: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(10000)]],
    isPrivate: [false],
  });

  submit(): void {
    this.form.markAllAsTouched();
    const rawBody = this.form.controls.body.value.replace(/<[^>]*>/g, '').trim();
    if (rawBody.length < 10) {
      this.showBodyError.set(true);
      return;
    }
    this.showBodyError.set(false);
    if (this.form.invalid) return;

    this.saving.set(true);
    const val = this.form.getRawValue();
    this.feedbackService
      .submit({
        category: val.category,
        title: val.title.trim(),
        body: normalizeNbsp(val.body),
        isPrivate: val.isPrivate,
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.submitted.set(true);
        },
        error: () => {
          this.saving.set(false);
          this.snackBar.open('Failed to send feedback — please try again', 'OK', {
            duration: 4000,
          });
        },
      });
  }

  onEditorCreated(quill: any): void {
    this.quillInstance = quill;
    quill.root.addEventListener('paste', (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) this.handleImageFile(file);
          break;
        }
      }
    });
  }

  onImageFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.handleImageFile(file);
    input.value = '';
  }

  private handleImageFile(file: File): void {
    this.feedbackService.uploadImage(file).subscribe({
      next: ({ url }) => {
        if (this.quillInstance) {
          const range = this.quillInstance.getSelection(true);
          this.quillInstance.insertEmbed(range.index, 'image', url);
          this.quillInstance.setSelection(range.index + 1);
        }
      },
      error: () => {
        this.snackBar.open('Image upload failed — please try again', 'OK', { duration: 4000 });
      },
    });
  }

  reset(): void {
    this.submitted.set(false);
    this.form.reset({ category: 'bug', title: '', body: '', isPrivate: false });
  }
}
