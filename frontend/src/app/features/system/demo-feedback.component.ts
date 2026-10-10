import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DatePipe } from '@angular/common';
import {
  FormBuilder,
  FormGroupDirective,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BrandConfigService } from '../../core/services/brand-config.service';
import {
  SystemReportsService,
  DemoFeedbackEntry,
} from '../../core/services/system-reports.service';

/**
 * What a demo visitor thought (v2-32).
 *
 * One component, two jobs, because they are the same page seen from two sides:
 * inside a demo it is a form for the visitor, and on the root tenant it is the
 * operator's list of everything that has been said. Splitting them would mean
 * two routes rendering the same rows under different names.
 *
 * The form is shown only inside a demo and the list only where there is
 * something to list, both decided from branding rather than guessed.
 */
@Component({
  selector: 'app-demo-feedback',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="demo-feedback-page">
      <h1>{{ isDemo() ? 'How is this demo going?' : 'Demo feedback' }}</h1>

      @if (isDemo()) {
        <!--
          The retention sentence is here because it is true and because it is
          the reason to bother writing anything: this demo is deleted within a
          week, and the note outlives it.
        -->
        <div class="disclosure">
          <mat-icon>schedule</mat-icon>
          <p>
            This demo community is deleted automatically, but what you write here is kept and read
            by the people building {{ platformName }} — along with
            <strong>your email address</strong>, so we can follow up if we need to. Tell us what
            worked and what didn't.
          </p>
        </div>

        <mat-card class="file-card">
          <form [formGroup]="form" (ngSubmit)="submit()">
            <div class="rating">
              <span class="rating-label">How did it go?</span>
              <mat-button-toggle-group formControlName="rating" aria-label="Rating">
                @for (n of [1, 2, 3, 4, 5]; track n) {
                  <mat-button-toggle [value]="n">{{ n }}</mat-button-toggle>
                }
              </mat-button-toggle-group>
              <span class="rating-hint">1 = poor, 5 = great. Optional.</span>
            </div>

            <div class="question">
              <span class="rating-label">Would you run your community on this?</span>
              <mat-button-toggle-group formControlName="wouldUse" aria-label="Would you use it">
                <mat-button-toggle value="yes">Yes</mat-button-toggle>
                <mat-button-toggle value="maybe">Maybe</mat-button-toggle>
                <mat-button-toggle value="no">No</mat-button-toggle>
              </mat-button-toggle-group>
            </div>

            <mat-form-field appearance="outline" class="full">
              <mat-label>What worked?</mat-label>
              <textarea matInput formControlName="whatWorked" rows="3" maxlength="5000"></textarea>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full">
              <mat-label>What got in your way?</mat-label>
              <textarea matInput formControlName="whatDidnt" rows="3" maxlength="5000"></textarea>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full">
              <mat-label>Anything else?</mat-label>
              <textarea matInput formControlName="body" rows="3" maxlength="5000"></textarea>
            </mat-form-field>

            <p class="optional-note">Every question is optional — answer whichever you like.</p>

            <div class="actions">
              <button mat-flat-button type="submit" [disabled]="!hasAnswer() || saving()">
                {{ saving() ? 'Sending…' : 'Send feedback' }}
              </button>
            </div>
          </form>
        </mat-card>
      }

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="32" /></div>
      } @else if (entries().length > 0) {
        <h2>{{ isDemo() ? 'What you have told us' : 'From demo visitors' }}</h2>
        @for (entry of entries(); track entry.id) {
          <mat-card class="entry-card">
            <div class="entry-head">
              <strong>{{ entry.submittedByEmail || entry.demoLabel }}</strong>
              @if (entry.rating !== null) {
                <span class="rating-chip">{{ entry.rating }}/5</span>
              }
            </div>
            @if (entry.wouldUse) {
              <p class="answer">
                <span class="answer-q">Would run their community on it:</span>
                {{ wouldUseLabel(entry.wouldUse) }}
              </p>
            }
            @if (entry.whatWorked) {
              <p class="answer"><span class="answer-q">What worked:</span> {{ entry.whatWorked }}</p>
            }
            @if (entry.whatDidnt) {
              <p class="answer">
                <span class="answer-q">What got in the way:</span> {{ entry.whatDidnt }}
              </p>
            }
            @if (entry.body) {
              <p class="answer"><span class="answer-q">Also:</span> {{ entry.body }}</p>
            }
            <div class="entry-meta">
              {{ entry.createdAt | date: 'medium' }}
              @if (entry.submittedByEmail) {
                · demo <strong>{{ entry.demoLabel }}</strong>
              }
            </div>
          </mat-card>
        }
      } @else if (!isDemo()) {
        <p class="empty">No demo feedback yet.</p>
      }
    </div>
  `,
  styles: [
    `
      .demo-feedback-page {
        max-width: 760px;
        margin: 0 auto;
      }
      h1 {
        font-family: var(--ce-font-display);
        color: var(--ce-text);
      }
      h2 {
        margin-top: 28px;
        font-size: 1.05rem;
        color: var(--ce-text);
      }
      .disclosure {
        display: flex;
        gap: 12px;
        align-items: flex-start;
        background: var(--ce-surface-variant);
        border-left: 4px solid var(--ce-banner);
        border-radius: 6px;
        padding: 12px 16px;
        margin-bottom: 20px;
        color: var(--ce-text);
        font-size: 0.88rem;
        line-height: 1.5;
      }
      .disclosure p {
        margin: 0;
      }
      .file-card,
      .entry-card {
        padding: 16px;
        margin-bottom: 14px;
      }
      .full {
        width: 100%;
      }
      .rating {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        margin-bottom: 16px;
      }
      .rating-label {
        font-weight: 600;
        color: var(--ce-text);
      }
      .rating-hint {
        font-size: 0.78rem;
        color: var(--ce-text-muted);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
      }
      .entry-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .answer {
        white-space: pre-wrap;
        color: var(--ce-text);
        margin: 6px 0;
        font-size: 0.9rem;
      }
      .answer-q {
        font-weight: 600;
        color: var(--ce-text-muted);
      }
      .question {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
        margin-bottom: 16px;
      }
      .optional-note {
        font-size: 0.78rem;
        color: var(--ce-text-muted);
        margin: 0 0 8px;
      }
      .entry-meta {
        font-size: 0.78rem;
        color: var(--ce-text-muted);
      }
      .rating-chip {
        font-size: 0.75rem;
        font-weight: 700;
        padding: 2px 8px;
        border-radius: 10px;
        background: var(--ce-surface-variant);
        color: var(--ce-text);
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 24px;
      }
      .empty {
        color: var(--ce-text-muted);
      }
    `,
  ],
})
export class DemoFeedbackComponent implements OnInit {
  private readonly reports = inject(SystemReportsService);
  private readonly brand = inject(BrandConfigService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(FormBuilder);

  readonly entries = signal<DemoFeedbackEntry[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);

  readonly isDemo = computed(() => this.brand.isDemo());
  readonly platformName = 'Community Events Project';

  /**
   * **No field is required, and the submit button is enabled by "any of them".**
   *
   * A survey that will not submit until one more box is filled is a survey that
   * gets abandoned, and a partial answer from somebody who used the product for
   * a week beats a complete answer from nobody. The service enforces the same
   * "at least one" rule, so this is a convenience rather than the guarantee.
   */
  // Same reason as the bug form: `reset()` leaves the directive submitted, so
  // the cleared form paints itself red. Nothing here is `required`, so this one
  // was not visibly broken -- it is kept identical so the next required field
  // added does not reintroduce it.
  private readonly formDirective = viewChild(FormGroupDirective);

  readonly form = this.fb.nonNullable.group({
    rating: this.fb.control<number | null>(null),
    wouldUse: this.fb.control<string | null>(null),
    whatWorked: ['', [Validators.maxLength(5000)]],
    whatDidnt: ['', [Validators.maxLength(5000)]],
    body: ['', [Validators.maxLength(5000)]],
  });

  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  readonly hasAnswer = computed(() => {
    const v = this.formValue();
    return Boolean(
      v.rating ||
        v.wouldUse ||
        v.whatWorked?.trim() ||
        v.whatDidnt?.trim() ||
        v.body?.trim(),
    );
  });

  wouldUseLabel(value: 'yes' | 'maybe' | 'no'): string {
    return { yes: 'Yes', maybe: 'Maybe', no: 'No' }[value];
  }

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.reports.listDemoFeedback().subscribe({
      next: (rows) => {
        this.entries.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  submit(): void {
    if (!this.hasAnswer()) return;
    this.saving.set(true);
    const v = this.form.getRawValue();
    this.reports
      .submitDemoFeedback({
        rating: v.rating,
        wouldUse: v.wouldUse,
        whatWorked: v.whatWorked?.trim() || null,
        whatDidnt: v.whatDidnt?.trim() || null,
        body: v.body?.trim() || null,
      })
      .subscribe({
      next: () => {
        this.saving.set(false);
        this.formDirective()?.resetForm({
          rating: null,
          wouldUse: null,
          whatWorked: '',
          whatDidnt: '',
          body: '',
        });
        this.snackBar.open('Thank you — that is genuinely useful.', 'OK', { duration: 3000 });
        this.load();
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Could not send that. Please try again.', 'OK', { duration: 5000 });
      },
    });
  }
}
