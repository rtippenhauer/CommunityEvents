import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BrandConfigService } from '../../core/services/brand-config.service';
import { AuthService } from '../../core/services/auth.service';
import {
  SystemReportsService,
  SystemBug,
  Reporter,
} from '../../core/services/system-reports.service';
import { FeedbackStatus } from '../../core/services/feedback.service';

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  shipped: 'Shipped',
  closed: 'Closed',
  wont_fix: "Won't fix",
};

/**
 * The shared defect board (v2-32).
 *
 * Every community's admins read the same list; only the operator can change
 * anything on it. The page is deliberately plain -- it is a working list, not a
 * product surface.
 */
@Component({
  selector: 'app-system-bugs',
  standalone: true,
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="bugs-page">
      <h1>Report a problem</h1>

      <!--
        The notice says who reads this, not just where it goes. An earlier
        draft said only "goes to the developers", which describes a private
        channel -- and somebody told that will write things they would never
        post to a shared board. The audience in the sentence is the audience in
        the code (Rob, 2026-10-04).
      -->
      <div class="disclosure">
        <mat-icon>groups</mat-icon>
        <p>
          This goes to the {{ platformName }} developers and is
          <strong>visible to the administrators of every community</strong> on this platform, so
          they can see a problem is already known. Describe what broke, not who it happened to —
          please don't include member names, email addresses, or anything else personal. Your own
          community's
          <strong>Feedback</strong> board is the private one.
        </p>
      </div>

      <mat-card class="file-card">
        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field appearance="outline" class="full">
            <mat-label>What's broken</mat-label>
            <input matInput formControlName="title" maxlength="200" />
          </mat-form-field>

          <mat-form-field appearance="outline" class="full">
            <mat-label>What happened, and what you expected</mat-label>
            <textarea matInput formControlName="body" rows="5" maxlength="10000"></textarea>
          </mat-form-field>

          <div class="actions">
            <button mat-flat-button type="submit" [disabled]="form.invalid || saving()">
              {{ saving() ? 'Sending…' : 'Send report' }}
            </button>
          </div>
        </form>
      </mat-card>

      <h2>Known problems</h2>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="32" /></div>
      } @else if (bugs().length === 0) {
        <p class="empty">Nothing reported yet.</p>
      } @else {
        @for (bug of bugs(); track bug.id) {
          <mat-card class="bug-card">
            <div class="bug-head">
              <strong>{{ bug.title }}</strong>
              <span class="status status-{{ bug.status }}">{{ statusLabel(bug.status) }}</span>
            </div>
            <p class="bug-body">{{ bug.body }}</p>
            <div class="bug-meta">
              <span>{{ describe(bug.reporter) }}</span>
              <span class="dot">·</span>
              <span>{{ bug.createdAt | date: 'mediumDate' }}</span>
            </div>

            @if (isOperator()) {
              <div class="triage">
                <mat-form-field appearance="outline" class="status-field">
                  <mat-label>Status</mat-label>
                  <mat-select
                    [value]="bug.status"
                    (selectionChange)="setStatus(bug, $event.value)"
                  >
                    @for (s of statuses; track s) {
                      <mat-option [value]="s">{{ statusLabel(s) }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
                @if (bug.adminNote) {
                  <p class="admin-note">{{ bug.adminNote }}</p>
                }
              </div>
            }
          </mat-card>
        }
      }
    </div>
  `,
  styles: [
    `
      .bugs-page {
        max-width: 860px;
        margin: 0 auto;
      }
      h1 {
        font-family: var(--ce-font-display);
        color: var(--ce-text);
      }
      h2 {
        margin-top: 32px;
        font-size: 1.1rem;
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
      .bug-card {
        padding: 16px;
        margin-bottom: 14px;
      }
      .full {
        width: 100%;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
      }
      .bug-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .bug-body {
        white-space: pre-wrap;
        color: var(--ce-text);
        margin: 8px 0;
      }
      .bug-meta {
        font-size: 0.78rem;
        color: var(--ce-text-muted);
        display: flex;
        gap: 6px;
      }
      .status {
        font-size: 0.72rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 2px 8px;
        border-radius: 10px;
        background: var(--ce-surface-variant);
        color: var(--ce-text);
        white-space: nowrap;
      }
      /* --ce-success is the platform-fixed green (v2-11): a resolved state
         means the same thing in every community, so it is one of the
         deliberate exceptions to branding. Used at low alpha so the chip reads
         as a tint rather than a solid badge competing with the title. */
      .status-resolved,
      .status-shipped {
        background: color-mix(in srgb, var(--ce-success) 35%, transparent);
      }
      .status-wont_fix,
      .status-closed {
        background: var(--ce-rule);
      }
      .triage {
        margin-top: 12px;
        border-top: 1px solid var(--ce-rule);
        padding-top: 12px;
      }
      .status-field {
        width: 200px;
      }
      .admin-note {
        white-space: pre-wrap;
        font-size: 0.85rem;
        color: var(--ce-text-muted);
        margin: 4px 0 0;
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
export class SystemBugsComponent implements OnInit {
  private readonly reports = inject(SystemReportsService);
  private readonly brand = inject(BrandConfigService);
  private readonly auth = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(FormBuilder);

  readonly bugs = signal<SystemBug[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);

  readonly statuses: FeedbackStatus[] = [
    'open',
    'in_progress',
    'resolved',
    'shipped',
    'closed',
    'wont_fix',
  ];

  /** The platform's own name, not this community's — the report leaves here. */
  readonly platformName = 'Community Events Project';

  /**
   * Triage controls are shown only to the system admin on the root tenant,
   * matching `SystemAdminGuard`. The API refuses regardless; this stops the
   * screen offering a control that cannot work, which is the exact defect the
   * Releases link had.
   */
  readonly isOperator = computed(
    () => this.brand.isRoot() && this.auth.currentUser()?.role === 'system_admin',
  );

  readonly form = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(200)]],
    body: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(10000)]],
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.reports.listBugs().subscribe({
      next: (rows) => {
        this.bugs.set(rows);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  submit(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const { title, body } = this.form.getRawValue();
    this.reports.fileBug(title, body).subscribe({
      next: () => {
        this.saving.set(false);
        this.form.reset();
        this.snackBar.open('Report sent. Thank you.', 'OK', { duration: 3000 });
        this.load();
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Could not send the report.', 'OK', { duration: 5000 });
      },
    });
  }

  setStatus(bug: SystemBug, status: FeedbackStatus): void {
    this.reports.updateBug(bug.id, { status }).subscribe({
      next: () => this.load(),
      error: () => this.snackBar.open('Could not update the report.', 'OK', { duration: 5000 }),
    });
  }

  statusLabel(status: FeedbackStatus): string {
    return STATUS_LABELS[status];
  }

  /**
   * The only place a reporter is turned into words, and it has no fallback that
   * could invent one: each arm renders exactly what the server chose to send.
   */
  describe(reporter: Reporter): string {
    switch (reporter.kind) {
      case 'self':
        return `Reported by ${reporter.fullName}`;
      case 'operator':
        return `Reported by ${reporter.fullName} (${reporter.community})`;
      case 'departed':
        return 'Reported by a community that has since closed';
      default:
        return 'Reported by an admin of another community';
    }
  }
}
