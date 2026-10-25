import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminCity, CitiesAdminService } from '../../../core/services/cities-admin.service';

export interface CityFormDialogData {
  city?: AdminCity;
}

/**
 * Add or rename a city.
 *
 * **The subdomain field is gone** (v2-24). A city is a row, not a hostname —
 * and the hint under that field composed its example host out of
 * `brandConfig.baseDomain()`, which is the community's **mail** domain, to
 * build what was meant to be a web address. Those are the two things CLAUDE.md
 * says must never be derived from each other, so the field took a wrong value
 * and presented it confidently.
 *
 * **Active is gone too**, and not because it stopped existing: retiring a city
 * moves rows off it and needs somewhere to put them, which is a conversation
 * rather than a toggle. It has its own dialog.
 */
@Component({
  selector: 'app-city-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.city ? 'Rename' : 'Add' }} city</h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="city-form">
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" />
          <mat-hint>Unique within this community</mat-hint>
          <mat-error>Name is required</mat-error>
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="primary" (click)="save()" [disabled]="form.invalid || saving">
        @if (saving) {
          <mat-spinner diameter="20" />
        } @else {
          Save
        }
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .city-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        min-width: 280px;
        padding-top: 8px;
      }
      mat-form-field {
        width: 100%;
      }
      @media (max-width: 480px) {
        .city-form {
          min-width: 0;
        }
      }
    `,
  ],
})
export class CityFormDialogComponent {
  readonly data = inject<CityFormDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<CityFormDialogComponent>);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly citiesAdminService = inject(CitiesAdminService);
  private readonly snackBar = inject(MatSnackBar);

  saving = false;

  readonly form = this.fb.group({
    name: [this.data.city?.name ?? '', [Validators.required, Validators.maxLength(100)]],
  });

  save(): void {
    if (this.form.invalid) return;
    this.saving = true;
    const payload = this.form.getRawValue();

    const req$ = this.data.city
      ? this.citiesAdminService.update(this.data.city.id, payload)
      : this.citiesAdminService.create(payload);

    req$.subscribe({
      next: (city) => {
        this.saving = false;
        this.dialogRef.close(city);
      },
      error: (err: HttpErrorResponse) => {
        this.saving = false;
        const msg = err?.error?.message ?? 'Save failed';
        this.snackBar.open(typeof msg === 'string' ? msg : JSON.stringify(msg), 'OK', {
          duration: 5000,
        });
      },
    });
  }
}
