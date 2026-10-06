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
import { BrandConfigService } from '../../core/services/brand-config.service';
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
import { firstValueFrom } from 'rxjs';
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
          <!-- This said "Bug reports, feature ideas, or general comments" until
               2026-10-04, which is now the opposite of what the page does: both
               of those go to the platform board. Stale copy that contradicts the
               form is worse than no copy, because it is read as the rule. -->
          How things are going in this community — your admins read every one.
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
            <!--
              The Type picker is gone (Rob, 2026-10-04). This board takes
              comments about THIS community; bugs and feature requests are about
              the product and go to the platform board, where every community
              can see them and the people who build it can act on them. A select
              with one remaining option is a question with one answer, so the
              field went and a signpost took its place.
            -->
            @if (!brandConfig.isDemo()) {
              <div class="route-note">
                <mat-icon>bug_report</mat-icon>
                <span>
                  Found a bug, or want a feature? That goes to
                  <a routerLink="/system/bugs">the platform board</a> instead — this one is for
                  comments about {{ brandConfig.brand().name }}.
                </span>
              </div>
            }

            <mat-form-field appearance="outline">
              <mat-label>Title</mat-label>
              <input
                matInput
                formControlName="title"
                placeholder="Brief summary of your comment"
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
                placeholder="Tell your admins what's on your mind…"
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
          color: var(--ce-chrome);
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
          border-color: var(--ce-primary);
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
      /* A pasted screenshot is whatever size it was captured at, and Quill
         renders it at natural width -- which on 2026-10-05 pushed the whole
         card off-centre and left a page of empty space beside it. Constrained
         to the editor rather than resized on upload, so the stored image keeps
         its detail for anyone who opens it. */
      ::ng-deep .quill-editor .ql-editor img {
        max-width: 100%;
        height: auto;
        display: block;
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
          color: var(--ce-chrome);
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
      .route-note {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        background: var(--ce-surface-variant);
        border-left: 4px solid var(--ce-banner);
        border-radius: 6px;
        padding: 10px 14px;
        margin-bottom: 16px;
        font-size: 0.85rem;
        line-height: 1.5;
        color: var(--ce-text);
      }
      .route-note a {
        color: var(--ce-text);
        font-weight: 600;
      }
    `,
  ],
})
export class FeedbackNewComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  // Public: the template names this community and hides the signpost on a demo.
  readonly brandConfig = inject(BrandConfigService);
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
    // Fixed: this board is comments only. See the template.
    category: ['comment' as FeedbackCategory, Validators.required],
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

    /**
     * **Never return silently** (Rob, 2026-10-05: "After I submitted Feedback
     * the page still showed me feedback and made it look like it didn't work").
     *
     * This was a bare `if (this.form.invalid) return;`. Title errors are visible
     * under their field, but the body is a Quill editor with no `mat-error`, so
     * a body over the length cap failed the form and the press did nothing at
     * all -- no spinner, no message, no change. A form that refuses without
     * saying so is indistinguishable from a broken one.
     *
     * The length is the case that actually bites: an embedded screenshot pushes
     * the HTML past the cap quickly, and that is the one failure a member cannot
     * guess at.
     */
    if (this.form.invalid) {
      const body = this.form.controls.body;
      if (body.hasError('maxlength')) {
        this.snackBar.open(
          'That description is too long — try removing an image or shortening the text.',
          'OK',
          { duration: 6000 },
        );
      } else if (this.form.controls.title.invalid) {
        this.snackBar.open('Please give it a title of at least 3 characters.', 'OK', {
          duration: 4000,
        });
      } else {
        this.snackBar.open('Please check the form and try again.', 'OK', { duration: 4000 });
      }
      return;
    }

    this.saving.set(true);
    // Any image that reached the body as a data URI is uploaded first and the
    // markup rewritten to point at it. See `uploadInlineImages`.
    void this.uploadInlineImages(this.form.controls.body.value).then((body) => {
      this.form.controls.body.setValue(body);
      this.send();
    });
  }

  /**
   * Replaces `src="data:image/..."` with an uploaded URL, and is the actual fix
   * for Rob's 2026-10-05 report that submitting did nothing and saved nothing.
   *
   * A screenshot embedded as base64 is hundreds of kilobytes of text, so the
   * body blew past `maxLength(10000)`, the form was invalid, and `submit()`
   * returned without a word. The paste handler in `onEditorCreated` uploads
   * images it recognises -- but it only sees `clipboardData.items`, and a data
   * URI can arrive by routes it never watches: pasted HTML carrying one, a
   * drag-and-drop, an image copied from another page, or anything Quill's own
   * clipboard matchers let through.
   *
   * So this is the belt rather than the braces: whatever got a data URI in, it
   * does not reach the server as one. Catching it here rather than at paste
   * time also means a body that was already drafted gets fixed on its way out.
   *
   * An upload that fails leaves that one image as it was -- the submit then
   * fails the length check and says so, which is better than dropping a
   * member's screenshot silently.
   */
  private async uploadInlineImages(html: string): Promise<string> {
    const dataUri = /<img[^>]+src="(data:image\/[a-z+]+;base64,[^"]+)"/gi;
    const matches = [...html.matchAll(dataUri)];
    if (matches.length === 0) return html;

    let result = html;
    for (const [, uri] of matches) {
      try {
        const blob = await (await fetch(uri)).blob();
        const ext = (blob.type.split('/')[1] ?? 'png').replace('+xml', '');
        const file = new File([blob], `pasted-${Date.now()}.${ext}`, { type: blob.type });
        const { url } = await firstValueFrom(this.feedbackService.uploadImage(file));
        result = result.split(uri).join(url);
      } catch {
        // Left as-is on purpose; the length check below reports it.
      }
    }
    return result;
  }

  private send(): void {
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
        error: (err: { error?: { message?: string | string[] } }) => {
          this.saving.set(false);
          // The API's own words where it gave any -- "body must be shorter
          // than 10000 characters" is actionable, "please try again" is not.
          const detail = err?.error?.message;
          const text = Array.isArray(detail) ? detail[0] : detail;
          this.snackBar.open(text || 'Failed to send feedback — please try again', 'OK', {
            duration: 6000,
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
    this.form.reset({ category: 'comment', title: '', body: '', isPrivate: false });
  }
}
