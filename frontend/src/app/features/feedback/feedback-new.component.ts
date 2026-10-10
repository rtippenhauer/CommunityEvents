import {
  Component,
  ElementRef,
  inject,
  signal,
  viewChild,
  ChangeDetectionStrategy,
  HostListener,
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
              multiple
              style="display:none"
              (change)="onImageFileSelected($event)"
            />

            <!--
              Attachments, below the description rather than inside it. A
              screenshot used to be embedded in the body, so two of them made
              the ticket too long to submit and a screenshots-only ticket was
              too short -- the size of a picture deciding whether the words
              were enough (Rob, 2026-10-06).
            -->
            <div class="shots">
              <div class="shots-head">
                <span>Screenshots</span>
                <button mat-stroked-button type="button" (click)="imageInput.click()">
                  <mat-icon>add_photo_alternate</mat-icon> Add
                </button>
                @if (uploading()) {
                  <mat-spinner diameter="18" />
                }
              </div>
              <p class="shots-hint">Paste one anywhere on this page, or add a file. Up to 5.</p>
              @if (shots().length > 0) {
                <div class="shot-list">
                  @for (shot of shots(); track shot) {
                    <div class="shot">
                      <img [src]="shot" alt="Attached screenshot" />
                      <!-- A plain button, not mat-icon-button: Material keeps a
                           40px touch target inside whatever size you give it, so
                           the glyph sat outside its own circle on a phone
                           (Rob, 2026-10-07). -->
                      <button
                        class="shot-remove"
                        type="button"
                        aria-label="Remove screenshot"
                        (click)="removeShot(shot)"
                      >
                        &times;
                      </button>
                    </div>
                  }
                </div>
              }
            </div>

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

      .shots { margin-bottom: 16px; }
      .shots-head {
        display: flex;
        align-items: center;
        gap: 12px;
        font-weight: 600;
        color: var(--ce-text);
      }
      .shots-hint {
        font-size: 0.78rem;
        color: var(--ce-text-muted);
        margin: 4px 0 8px;
      }
      .shot-list { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
      .shot { position: relative; display: inline-flex; }
      .shot img {
        max-width: 140px;
        max-height: 110px;
        border-radius: 6px;
        border: 1px solid var(--ce-rule);
        display: block;
      }
      .shot-remove {
        position: absolute;
        top: -9px;
        right: -9px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        font-size: 17px;
        line-height: 1;
        background: var(--ce-surface);
        color: var(--ce-text);
        border: 1px solid var(--ce-rule);
        border-radius: 50%;
        cursor: pointer;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
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

  private quillInstance: any = null;

  readonly saving = signal(false);
  readonly submitted = signal(false);
  readonly showBodyError = signal(false);
  /** Attached images — files on the ticket, never markup in the body. */
  readonly shots = signal<string[]>([]);
  readonly uploading = signal(false);

  readonly quillModules = {
    toolbar: {
      container: [
        ['bold', 'italic', 'underline', 'strike'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        // No 'image': attachments are files on the ticket now, not markup in
        // the body, so inserting one here would put it back in the body.
        ['link'],
        ['clean'],
      ],
      handlers: {
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

  /**
   * **Images come out of the description before anything is validated**
   * (Rob, 2026-10-07, reported from a phone).
   *
   * On iOS the editor takes a photo straight into the body as a `data:` URI --
   * no paste event carries a file, so the attach handlers never see it. The
   * body then fails `maxLength`, and the ORDER made that fatal: the length
   * check ran first and returned, so the repair never got the chance to shrink
   * the body it was complaining about. The member saw "that description is too
   * long" beside an empty Screenshots box, with no way to act on it.
   *
   * So extraction runs first, and it does not merely rewrite the markup to a
   * URL: it REMOVES the image from the body and adds it to the attachments,
   * which is where it belongs. After that the description is text, the limits
   * mean what they say, and a phone behaves like a desktop.
   */
  submit(): void {
    this.form.markAllAsTouched();
    this.saving.set(true);
    void this.extractInlineImages(this.form.controls.body.value).then((body) => {
      this.form.controls.body.setValue(body);
      this.saving.set(false);
      if (this.validate()) this.send();
    });
  }

  /** Returns false and says why, rather than refusing in silence. */
  private validate(): boolean {
    const rawBody = this.form.controls.body.value.replace(/<[^>]*>/g, '').trim();
    if (rawBody.length < 10) {
      this.showBodyError.set(true);
      return false;
    }
    this.showBodyError.set(false);

    if (this.form.invalid) {
      if (this.form.controls.body.hasError('maxlength')) {
        this.snackBar.open('That description is too long — please shorten it.', 'OK', {
          duration: 6000,
        });
      } else if (this.form.controls.title.invalid) {
        this.snackBar.open('Please give it a title of at least 3 characters.', 'OK', {
          duration: 4000,
        });
      } else {
        this.snackBar.open('Please check the form and try again.', 'OK', { duration: 4000 });
      }
      return false;
    }
    return true;
  }

  /**
   * Pulls every inline image out of the body and attaches it instead.
   *
   * `data:` covers what iOS inserts and what a pasted HTML fragment carries;
   * `blob:` covers the object URLs some editors use. Both are fetchable from
   * the page holding them, which is what makes this possible at all.
   *
   * An upload that fails leaves that image in the body untouched -- better a
   * ticket refused for length, with the picture still visible to its author,
   * than one that submits with their screenshot silently discarded.
   */
  private async extractInlineImages(html: string): Promise<string> {
    const inline = /<img\b[^>]*\bsrc="(data:image\/[^"]+|blob:[^"]+)"[^>]*>/gi;
    const matches = [...html.matchAll(inline)];
    if (matches.length === 0) return html;

    let result = html;
    for (const [tag, src] of matches) {
      if (this.shots().length >= 5) break;
      try {
        const blob = await (await fetch(src)).blob();
        const ext = (blob.type.split('/')[1] ?? 'png').replace('+xml', '');
        const file = new File([blob], `pasted-${Date.now()}.${ext}`, { type: blob.type });
        const { url } = await firstValueFrom(this.feedbackService.uploadImage(file));
        this.shots.update((current) => [...current, url]);
        result = result.split(tag).join('');
      } catch {
        // Left in the body on purpose; validate() then reports the length.
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
        screenshots: this.shots(),
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
    for (const file of Array.from(input.files ?? [])) this.handleImageFile(file);
    // Cleared so picking the same file twice in a row still fires `change`.
    input.value = '';
  }

  /**
   * Catches a pasted image anywhere on the page, not only inside the editor.
   *
   * The editor-scoped listener stays for the case where the cursor is in the
   * description, but a screenshot is pasted wherever the cursor happens to be
   * and asking somebody to click into the right box first is an instruction
   * nobody reads. A paste carrying no image falls through untouched.
   */
  @HostListener('document:paste', ['$event'])
  onPagePaste(event: ClipboardEvent): void {
    const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length === 0) return;
    event.preventDefault();
    for (const file of files) this.handleImageFile(file);
  }

  /**
   * Uploads one image and attaches it to the ticket.
   *
   * It used to `insertEmbed` into the editor, which is what put screenshots in
   * the body and made a picture count against the description's length limits.
   * Same upload, different destination.
   */
  private handleImageFile(file: File): void {
    if (this.shots().length >= 5) {
      this.snackBar.open('Up to 5 images.', 'OK', { duration: 4000 });
      return;
    }
    this.uploading.set(true);
    this.feedbackService.uploadImage(file).subscribe({
      next: ({ url }) => {
        this.uploading.set(false);
        this.shots.update((current) => [...current, url]);
      },
      error: () => {
        this.uploading.set(false);
        this.snackBar.open('Image upload failed — please try again', 'OK', { duration: 4000 });
      },
    });
  }

  removeShot(url: string): void {
    this.shots.update((current) => current.filter((u) => u !== url));
  }

  reset(): void {
    this.submitted.set(false);
    this.form.reset({ category: 'comment', title: '', body: '', isPrivate: false });
    this.shots.set([]);
  }
}
