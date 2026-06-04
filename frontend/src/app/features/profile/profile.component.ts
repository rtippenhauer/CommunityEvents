import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';

interface City {
  id: number;
  name: string;
  subdomain: string;
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="profile-container">
      <mat-card>
        <mat-card-header>
          <mat-card-title>Your Profile</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          @if (saving()) {
            <mat-spinner diameter="32" />
          } @else {
            <form [formGroup]="form" (ngSubmit)="save()" class="profile-form">
              <mat-form-field appearance="outline">
                <mat-label>Full Name</mat-label>
                <input matInput formControlName="fullName" />
                <mat-error>Name is required</mat-error>
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>City</mat-label>
                <mat-select formControlName="cityId">
                  @for (city of cities(); track city.id) {
                    <mat-option [value]="city.id">{{ city.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Email</mat-label>
                <input matInput [value]="authService.currentUser()?.email" readonly />
              </mat-form-field>

              <div class="photo-section">
                <span class="photo-label">Profile Photo</span>
                <input
                  id="photo-upload"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="Upload profile photo"
                  (change)="onPhotoSelected($event)"
                />
              </div>

              <mat-card-actions>
                <button
                  mat-raised-button
                  color="primary"
                  type="submit"
                  [disabled]="form.invalid || saving()"
                >
                  Save Changes
                </button>
              </mat-card-actions>
            </form>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .profile-container {
        max-width: 600px;
        margin: 0 auto;
      }
      .profile-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding: 16px 0;
      }
      .photo-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
        font-size: 0.875rem;
      }
    `,
  ],
})
export class ProfileComponent implements OnInit {
  readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly snackBar = inject(MatSnackBar);

  readonly cities = signal<City[]>([]);
  readonly saving = signal(false);

  readonly form = this.fb.group({
    fullName: ['', [Validators.required, Validators.maxLength(200)]],
    cityId: [0, Validators.required],
  });

  ngOnInit(): void {
    this.http.get<City[]>('/api/v1/cities').subscribe((cities) => {
      this.cities.set(cities);
    });

    const user = this.authService.currentUser();
    if (user) {
      this.form.patchValue({ fullName: user.fullName, cityId: user.cityId });
    }
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.http.patch('/api/v1/users/me', this.form.getRawValue()).subscribe({
      next: () => {
        this.snackBar.open('Profile updated', 'OK', { duration: 3000 });
        this.saving.set(false);
      },
      error: () => {
        this.snackBar.open('Failed to save', 'OK', { duration: 3000 });
        this.saving.set(false);
      },
    });
  }

  onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('photo', file);
    this.http.post('/api/v1/users/me/photo', formData).subscribe({
      next: () => this.snackBar.open('Photo updated', 'OK', { duration: 3000 }),
      error: () => this.snackBar.open('Photo upload failed', 'OK', { duration: 3000 }),
    });
  }
}
