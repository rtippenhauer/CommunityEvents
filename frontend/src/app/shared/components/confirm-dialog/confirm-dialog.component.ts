import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel?: string;
  confirmColor?: 'primary' | 'warn' | 'accent';
  /**
   * Hides Cancel, leaving a single acknowledging button.
   *
   * For telling somebody something rather than asking them. A refusal they can
   * do nothing about should not offer a choice between two buttons that both
   * close the dialog -- and a snackbar is too easy to miss for something that
   * stopped an action, which is what prompted this (Rob, 2026-10-03).
   */
  acknowledgeOnly?: boolean;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>{{ data.message }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (!data.acknowledgeOnly) {
        <button mat-button mat-dialog-close>Cancel</button>
      }
      <button mat-raised-button [color]="data.confirmColor ?? 'primary'" (click)="confirm()">
        {{ data.confirmLabel ?? (data.acknowledgeOnly ? 'OK' : 'Confirm') }}
      </button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDialogComponent {
  readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<ConfirmDialogComponent>);

  confirm(): void {
    this.ref.close(true);
  }
}
