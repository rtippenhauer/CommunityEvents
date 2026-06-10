import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatIconModule } from '@angular/material/icon';
import { FeedbackService, FeedbackCategory } from '../../core/services/feedback.service';

@Component({
  selector: 'app-feedback-submit',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatIconModule,
  ],
  template: `
    <div class="feedback-page">
      <div class="feedback-card">
        <div class="feedback-header">
          <mat-icon class="header-icon">feedback</mat-icon>
          <div>
            <h1>Send Feedback</h1>
            <p class="subtitle">Bug reports, feature ideas, or general comments — we read everything.</p>
          </div>
        </div>

        @if (submitted()) {
          <div class="success-state">
            <mat-icon class="success-icon">check_circle</mat-icon>
            <h2>Thanks for the feedback!</h2>
            <p>We'll review it and may reach out if we have questions.</p>
            <div class="success-actions">
              <button mat-stroked-button (click)="reset()">Send more feedback</button>
              <button mat-raised-button color="primary" (click)="goBack()">Back to events</button>
            </div>
          </div>
        } @else {
          <form [formGroup]="form" (ngSubmit)="submit()" class="feedback-form">

            <mat-form-field appearance="outline">
              <mat-label>Type</mat-label>
              <mat-select formControlName="category">
                <mat-option value="bug">
                  <span class="option-row"><mat-icon class="opt-icon bug-icon">bug_report</mat-icon> Bug Report</span>
                </mat-option>
                <mat-option value="feature_request">
                  <span class="option-row"><mat-icon class="opt-icon feature-icon">lightbulb</mat-icon> Feature Request</span>
                </mat-option>
                <mat-option value="comment">
                  <span class="option-row"><mat-icon class="opt-icon comment-icon">chat_bubble_outline</mat-icon> General Comment</span>
                </mat-option>
              </mat-select>
              <mat-error>Please select a type</mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Description</mat-label>
              <textarea
                matInput
                formControlName="body"
                rows="6"
                placeholder="Describe the issue or idea in as much detail as you can…"
              ></textarea>
              <mat-hint align="end">{{ form.controls.body.value.length }} / 5000</mat-hint>
              <mat-error>
                @if (form.controls.body.hasError('minlength')) { Please write at least 10 characters }
                @else { Description is required }
              </mat-error>
            </mat-form-field>

            <div class="form-actions">
              <button mat-button type="button" (click)="goBack()">Cancel</button>
              <button
                mat-raised-button
                color="primary"
                type="submit"
                [disabled]="saving()"
              >
                @if (saving()) { <mat-spinner diameter="18" /> }
                @else { Send Feedback }
              </button>
            </div>

          </form>
        }
      </div>
    </div>
  `,
  styles: [`
    .feedback-page {
      max-width: 600px;
      margin: 32px auto;
      padding: 0 16px;
    }
    .feedback-card {
      background: var(--mat-card-container-color, #fff);
      border-radius: 12px;
      padding: 32px;
      box-shadow: 0 2px 12px rgba(61,28,5,0.10);
    }
    .feedback-header {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 28px;
      .header-icon { font-size: 2rem; width: 2rem; height: 2rem; color: var(--db-amber, #c9933a); margin-top: 4px; }
      h1 { margin: 0 0 4px; font-size: 1.5rem; color: var(--db-brown-dark); }
    }
    .subtitle { margin: 0; font-size: 0.9rem; color: #666; }
    .feedback-form { display: flex; flex-direction: column; gap: 16px; }
    mat-form-field { width: 100%; }
    .option-row { display: flex; align-items: center; gap: 8px; }
    .opt-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; }
    .bug-icon { color: #c62828; }
    .feature-icon { color: #e65100; }
    .comment-icon { color: #1565c0; }
    .form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 4px; }
    .success-state {
      text-align: center;
      padding: 16px 0;
      .success-icon { font-size: 3.5rem; width: 3.5rem; height: 3.5rem; color: #2e7d32; margin-bottom: 12px; }
      h2 { margin: 0 0 8px; color: var(--db-brown-dark); }
      p { color: #666; margin: 0 0 24px; }
    }
    .success-actions { display: flex; justify-content: center; gap: 12px; flex-wrap: wrap; }
  `],
})
export class FeedbackSubmitComponent {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly feedbackService = inject(FeedbackService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly saving = signal(false);
  readonly submitted = signal(false);

  readonly form = this.fb.group({
    category: ['bug' as FeedbackCategory, Validators.required],
    body: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(5000)]],
  });

  submit(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.saving.set(true);
    const val = this.form.getRawValue();
    this.feedbackService.submit({ category: val.category, body: val.body.trim() }).subscribe({
      next: () => { this.saving.set(false); this.submitted.set(true); },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Failed to send feedback — please try again', 'OK', { duration: 4000 });
      },
    });
  }

  reset(): void {
    this.submitted.set(false);
    this.form.reset({ category: 'bug', body: '' });
  }

  goBack(): void {
    void this.router.navigate(['/events']);
  }
}
