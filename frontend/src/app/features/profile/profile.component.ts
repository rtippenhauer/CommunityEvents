import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';
import { PhotoCropDialogComponent } from '../../shared/components/photo-crop-dialog/photo-crop-dialog.component';

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
    MatDialogModule,
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

              <!-- Photo section -->
              <div class="photo-section">
                <span class="photo-label">Profile Photo</span>
                <div class="photo-row">
                  <div class="photo-preview" role="button" tabindex="0"
                    (click)="openFilePicker()" (keydown.enter)="openFilePicker()"
                    title="Click to change photo">
                    @if (photoUrl()) {
                      <img [src]="photoUrl()" alt="Profile photo" class="profile-photo" />
                    } @else {
                      <div class="photo-placeholder">
                        <span class="placeholder-icon">👤</span>
                      </div>
                    }
                    <div class="photo-overlay">Change</div>
                  </div>
                  <div class="photo-actions">
                    <button mat-stroked-button type="button" (click)="openFilePicker()">
                      Choose photo…
                    </button>
                    @if (photoUrl()) {
                      <button mat-button type="button" color="warn" (click)="removePhoto()">
                        Remove
                      </button>
                    }
                    <p class="photo-hint">Square images work best. Max 5 MB.</p>
                  </div>
                </div>
                <input
                  #fileInput
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  style="display:none"
                  (change)="onFileSelected($event)"
                />
              </div>

              <mat-card-actions>
                <button mat-raised-button color="primary" type="submit"
                  [disabled]="form.invalid || saving()">
                  Save Changes
                </button>
              </mat-card-actions>

            </form>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
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
      gap: 10px;
    }
    .photo-label {
      font-size: 0.875rem;
      color: #555;
    }
    .photo-row {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .photo-preview {
      position: relative;
      width: 96px;
      height: 96px;
      border-radius: 50%;
      overflow: hidden;
      cursor: pointer;
      flex-shrink: 0;
      border: 2px solid #ddd;
    }
    .profile-photo {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .photo-placeholder {
      width: 100%;
      height: 100%;
      background: #f0f0f0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
    }
    .photo-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.45);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.8rem;
      font-weight: 500;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .photo-preview:hover .photo-overlay {
      opacity: 1;
    }
    .photo-actions {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }
    .photo-hint {
      font-size: 0.75rem;
      color: #999;
      margin: 0;
    }
  `],
})
export class ProfileComponent implements OnInit {
  readonly authService = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  readonly cities = signal<City[]>([]);
  readonly saving = signal(false);
  readonly photoUrl = signal<string | null>(null);

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
      const path = user.profilePhotoPath;
      this.photoUrl.set(path?.startsWith('/api/uploads/') ? path : null);
    }
  }

  openFilePicker(): void {
    document.querySelector<HTMLInputElement>('input[type="file"]')?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const ref = this.dialog.open(PhotoCropDialogComponent, {
      data: { file },
      disableClose: true,
      maxWidth: '95vw',
    });

    ref.afterClosed().subscribe((blob: Blob | null) => {
      if (!blob) return;
      this.uploadBlob(blob);
    });
  }

  private uploadBlob(blob: Blob): void {
    const formData = new FormData();
    formData.append('photo', blob, 'profile.jpg');
    this.http.post<{ url: string }>('/api/v1/users/me/photo', formData).subscribe({
      next: (res) => {
        this.photoUrl.set(res.url);
        this.snackBar.open('Photo updated', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Photo upload failed', 'OK', { duration: 3000 }),
    });
  }

  removePhoto(): void {
    this.http.patch('/api/v1/users/me', { profilePhotoPath: null }).subscribe({
      next: () => {
        this.photoUrl.set(null);
        this.snackBar.open('Photo removed', 'OK', { duration: 3000 });
      },
    });
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
}
