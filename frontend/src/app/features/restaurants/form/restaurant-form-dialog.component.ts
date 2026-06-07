import { Component, inject, OnInit } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Restaurant, RestaurantsService } from '../../../core/services/restaurants.service';

export interface RestaurantFormDialogData {
  restaurant?: Restaurant;
}

interface City {
  id: number;
  name: string;
}

@Component({
  selector: 'app-restaurant-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.restaurant ? 'Edit' : 'Add' }} Restaurant</h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="restaurant-form">
        <mat-form-field appearance="outline">
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" />
          <mat-error>Name is required</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Address</mat-label>
          <input matInput formControlName="address" />
          <mat-hint>Full street address — used for geocoding</mat-hint>
          <mat-error>Address is required</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>City</mat-label>
          <mat-select formControlName="cityId">
            @for (city of cities; track city.id) {
              <mat-option [value]="city.id">{{ city.name }}</mat-option>
            }
          </mat-select>
          <mat-error>City is required</mat-error>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Phone</mat-label>
          <input matInput formControlName="phone" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Website URL</mat-label>
          <input matInput formControlName="websiteUrl" placeholder="https://..." />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Description</mat-label>
          <textarea matInput formControlName="description" rows="4"></textarea>
        </mat-form-field>
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
  styles: [
    `
      .restaurant-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: min(90vw, 520px);
        padding-top: 8px;
      }
    `,
  ],
})
export class RestaurantFormDialogComponent implements OnInit {
  readonly data = inject<RestaurantFormDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<RestaurantFormDialogComponent>);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly http = inject(HttpClient);
  private readonly restaurantsService = inject(RestaurantsService);
  private readonly snackBar = inject(MatSnackBar);

  cities: City[] = [];
  saving = false;

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    address: ['', [Validators.required, Validators.maxLength(500)]],
    cityId: [0, [Validators.required, Validators.min(1)]],
    phone: [''],
    websiteUrl: [''],
    description: [''],
  });

  ngOnInit(): void {
    this.http.get<City[]>('/api/v1/cities').subscribe((cities) => {
      this.cities = cities;
    });
    if (this.data.restaurant) {
      const r = this.data.restaurant;
      this.form.patchValue({
        name: r.name,
        address: r.address,
        cityId: r.cityId,
        phone: r.phone ?? '',
        websiteUrl: r.websiteUrl ?? '',
        description: r.description ?? '',
      });
    }
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving = true;
    const val = this.form.getRawValue();
    const payload = {
      name: val.name,
      address: val.address,
      cityId: val.cityId,
      phone: val.phone.trim() || null,
      websiteUrl: val.websiteUrl.trim() || null,
      description: val.description.trim() || null,
    };

    const req$ = this.data.restaurant
      ? this.restaurantsService.update(this.data.restaurant.id, payload)
      : this.restaurantsService.create(payload);

    req$.subscribe({
      next: (restaurant) => this.dialogRef.close(restaurant),
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
