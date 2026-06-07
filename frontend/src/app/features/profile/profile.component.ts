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
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../core/services/auth.service';
import { PhotoCropDialogComponent } from '../../shared/components/photo-crop-dialog/photo-crop-dialog.component';

interface City {
  id: number;
  name: string;
  subdomain: string;
}

const PRESET_AVATARS = [
  { path: '/avatars/bear-chef.jpg',      label: 'Chef' },
  { path: '/avatars/bear-flannel.jpg',   label: 'Flannel' },
  { path: '/avatars/bear-cool.jpg',      label: 'Cool' },
  { path: '/avatars/bear-rainbow.jpg',   label: 'Rainbow' },
  { path: '/avatars/bear-hoodie.jpg',    label: 'Hoodie' },
  { path: '/avatars/bear-bookworm.jpg',  label: 'Bookworm' },
  { path: '/avatars/bear-explorer.jpg',  label: 'Explorer' },
  { path: '/avatars/bear-musician.jpg',  label: 'Musician' },
  { path: '/avatars/bear-athlete.jpg',   label: 'Athlete' },
  { path: '/avatars/bear-dapper.jpg',    label: 'Dapper' },
  { path: '/avatars/bear-astronaut.jpg', label: 'Astronaut' },
  { path: '/avatars/bear-artist.jpg',    label: 'Artist' },
  { path: '/avatars/bear-disco.jpg',     label: 'Disco' },
  { path: '/avatars/bear-karaoke.jpg',   label: 'Karaoke' },
];

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
    MatTabsModule,
    MatTooltipModule,
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

                <div class="photo-current">
                  <div class="photo-preview">
                    @if (photoUrl()) {
                      <img [src]="photoUrl()!" alt="Profile photo" class="profile-photo" />
                    } @else {
                      <div class="photo-placeholder">
                        <span class="placeholder-icon">🐻</span>
                      </div>
                    }
                  </div>
                  @if (photoUrl()) {
                    <button mat-button type="button" color="warn" (click)="removePhoto()">
                      Remove
                    </button>
                  }
                </div>

                <mat-tab-group animationDuration="150ms">
                  <mat-tab label="Choose a Bear">
                    <div class="avatar-grid">
                      @for (avatar of presetAvatars; track avatar.path) {
                        <button
                          type="button"
                          class="avatar-tile"
                          [class.selected]="photoUrl() === avatar.path"
                          [matTooltip]="avatar.label"
                          (click)="selectAvatar(avatar.path)">
                          <img [src]="avatar.path" [alt]="avatar.label" />
                          @if (photoUrl() === avatar.path) {
                            <div class="avatar-check">✓</div>
                          }
                        </button>
                      }
                    </div>
                  </mat-tab>
                  <mat-tab label="Upload Photo">
                    <div class="upload-tab">
                      <button mat-stroked-button type="button" (click)="openFilePicker()">
                        Choose photo…
                      </button>
                      <p class="photo-hint">Square images work best. Max 5 MB. JPEG, PNG, or WebP.</p>
                    </div>
                  </mat-tab>
                </mat-tab-group>

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
      gap: 12px;
    }
    .photo-label {
      font-size: 0.875rem;
      color: #555;
      font-weight: 500;
    }
    .photo-current {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .photo-preview {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      overflow: hidden;
      flex-shrink: 0;
      border: 2px solid #ddd;
    }
    .profile-photo {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: center top;
      display: block;
    }
    .photo-placeholder {
      width: 100%;
      height: 100%;
      background: #f0f0f0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2rem;
    }
    .avatar-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      padding: 12px 0;
    }
    .avatar-tile {
      position: relative;
      border: 2px solid transparent;
      border-radius: 8px;
      overflow: hidden;
      cursor: pointer;
      padding: 0;
      background: none;
      transition: border-color 0.15s, transform 0.15s;

      img {
        width: 100%;
        height: auto;
        display: block;
      }

      &:hover {
        border-color: var(--db-primary, #1E4D8C);
        transform: scale(1.04);
      }

      &.selected {
        border-color: var(--db-primary, #1E4D8C);
        box-shadow: 0 0 0 2px var(--db-primary, #1E4D8C);
      }
    }
    .avatar-check {
      position: absolute;
      inset: 0;
      background: rgba(30, 77, 140, 0.45);
      color: #fff;
      font-size: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
    }
    .upload-tab {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      padding: 12px 0;
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

  readonly presetAvatars = PRESET_AVATARS;
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
      this.photoUrl.set(path ?? null);
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
        this.authService.updatePhoto(res.url);
        this.snackBar.open('Photo updated', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Photo upload failed', 'OK', { duration: 3000 }),
    });
  }

  selectAvatar(path: string): void {
    this.http.post<{ url: string }>('/api/v1/users/me/avatar', { avatarPath: path }).subscribe({
      next: (res) => {
        this.photoUrl.set(res.url);
        this.authService.updatePhoto(res.url);
        this.snackBar.open('Avatar updated', 'OK', { duration: 3000 });
      },
      error: () => this.snackBar.open('Failed to set avatar', 'OK', { duration: 3000 }),
    });
  }

  removePhoto(): void {
    this.http.patch('/api/v1/users/me', { profilePhotoPath: null }).subscribe({
      next: () => {
        this.photoUrl.set(null);
        this.authService.updatePhoto(null);
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
