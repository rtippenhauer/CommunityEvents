import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminCity, CitiesAdminService } from '../../../core/services/cities-admin.service';
import { BrandConfigService } from '../../../core/services/brand-config.service';

export interface CityFormDialogData {
  city?: AdminCity;
}

@Component({
  selector: 'app-city-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.city ? 'Edit' : 'Add' }} City</h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="city-form">
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" />
          <mat-error>Name is required</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Subdomain</mat-label>
          <input matInput formControlName="subdomain" />
          <mat-hint
            >{{ form.getRawValue().subdomain || 'subdomain' }}.{{ baseDomain }} — lowercase letters,
            numbers, and hyphens only</mat-hint
          >
          <mat-error>Lowercase letters, numbers, and hyphens only</mat-error>
        </mat-form-field>

        <mat-slide-toggle formControlName="isActive">Active</mat-slide-toggle>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button
        mat-raised-button
        color="primary"
        (click)="save()"
        [disabled]="form.invalid || saving"
      >
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
        min-width: 320px;
        padding-top: 8px;
      }
      mat-form-field {
        width: 100%;
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
  private readonly brandConfig = inject(BrandConfigService);

  get baseDomain(): string {
    return this.brandConfig.baseDomain();
  }
  saving = false;

  readonly form = this.fb.group({
    name: [this.data.city?.name ?? '', [Validators.required, Validators.maxLength(100)]],
    subdomain: [
      this.data.city?.subdomain ?? '',
      [Validators.required, Validators.maxLength(50), Validators.pattern(/^[a-z0-9-]+$/)],
    ],
    isActive: [this.data.city?.isActive ?? true],
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
