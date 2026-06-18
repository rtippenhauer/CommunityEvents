import { Component, inject, input, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef, MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../../core/services/auth.service';
import { ReportsService, ReportContentType } from '../../../core/services/reports.service';

export interface ReportDialogResult {
  reason?: string;
}

@Component({
  selector: 'app-report-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>Report Content</h2>
    <mat-dialog-content>
      <p class="report-info">
        Report this to the moderation team. Moderators will review it and take action
        if it violates community guidelines.
      </p>
      <mat-form-field appearance="outline" class="reason-field">
        <mat-label>Reason (optional)</mat-label>
        <textarea matInput [formControl]="reasonCtrl" rows="3" maxlength="500"
          placeholder="Describe why this content is inappropriate…"></textarea>
        <mat-hint align="end">{{ reasonCtrl.value.length }}/500</mat-hint>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="warn" (click)="confirm()">Report</button>
    </mat-dialog-actions>
  `,
  styles: [`
    .report-info { font-size: 0.875rem; color: #666; margin: 0 0 16px; }
    .reason-field { width: 100%; }
    mat-dialog-content { min-width: 320px; }
  `],
})
export class ReportDialogComponent {
  readonly reasonCtrl = inject(NonNullableFormBuilder).control('');
  private readonly ref = inject(MatDialogRef<ReportDialogComponent, ReportDialogResult>);

  confirm(): void {
    const reason = this.reasonCtrl.value.trim();
    this.ref.close({ reason: reason || undefined });
  }
}

@Component({
  selector: 'app-report-button',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  template: `
    @if (showButton()) {
      <button mat-icon-button
        class="report-btn"
        matTooltip="Report"
        [disabled]="reported()"
        (click)="openDialog()">
        <mat-icon [class.reported-icon]="reported()">flag</mat-icon>
      </button>
    }
  `,
  styles: [`
    .report-btn { opacity: 0.45; transition: opacity 0.15s; }
    .report-btn:hover { opacity: 1; }
    .reported-icon { color: #ef5350; }
  `],
})
export class ReportButtonComponent {
  readonly contentType = input.required<ReportContentType>();
  readonly contentId = input.required<number>();
  readonly authorId = input.required<number>();

  private readonly authService = inject(AuthService);
  private readonly reportsService = inject(ReportsService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly reported = signal(false);

  readonly showButton = () => {
    const me = this.authService.currentUser();
    return !!me && me.id !== this.authorId();
  };

  openDialog(): void {
    this.dialog.open<ReportDialogComponent, void, ReportDialogResult>(
      ReportDialogComponent,
      { width: '400px' },
    ).afterClosed().subscribe((result) => {
      if (!result) return; // cancelled
      this.reportsService.submit(this.contentType(), this.contentId(), result.reason).subscribe({
        next: () => {
          this.reported.set(true);
          this.snackBar.open('Report submitted — moderators will review it.', 'OK', { duration: 4000 });
        },
        error: (err) => {
          const msg = err?.error?.message as string | undefined;
          if (msg?.includes('already reported')) {
            this.reported.set(true);
            this.snackBar.open('You have already reported this content.', 'OK', { duration: 3000 });
          } else {
            this.snackBar.open(msg ?? 'Failed to submit report', 'OK', { duration: 3000 });
          }
        },
      });
    });
  }
}
