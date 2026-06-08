import { Component, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { EnrichDiagnoseDialogComponent } from './enrich-diagnose-dialog.component';
import { RestaurantsService, Restaurant } from '../../../core/services/restaurants.service';
import { AuthService } from '../../../core/services/auth.service';
import { RestaurantFormDialogComponent } from '../form/restaurant-form-dialog.component';
import { PhotoCropDialogComponent } from '../../../shared/components/photo-crop-dialog/photo-crop-dialog.component';
import { EventFormDialogComponent } from '../../events/form/event-form-dialog.component';
import { Event as DinnerEvent } from '../../../core/services/events.service';

@Component({
  selector: 'app-restaurant-detail',
  standalone: true,
  imports: [
    DatePipe,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatIconModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    @if (loading()) {
      <div class="center"><mat-spinner /></div>
    } @else if (restaurant()) {
      <div class="detail-page">
        <!-- Back + actions -->
        <div class="top-bar">
          <button mat-button routerLink="/restaurants">
            <mat-icon>arrow_back</mat-icon> Restaurants
          </button>
          @if (isAdminOrMod()) {
            <div class="actions">
              <button mat-raised-button color="primary" (click)="createEvent()">
                <mat-icon>event</mat-icon> Create Event
              </button>
              <button mat-icon-button [matMenuTriggerFor]="adminMenu" aria-label="More actions">
                <mat-icon>more_vert</mat-icon>
              </button>
              <mat-menu #adminMenu="matMenu">
                <button mat-menu-item (click)="openEdit()">
                  <mat-icon>edit</mat-icon> Edit
                </button>
                <button mat-menu-item (click)="openAddPhoto()">
                  <mat-icon>add_photo_alternate</mat-icon> Add Photo
                </button>
                @if (isAdmin()) {
                  <button mat-menu-item (click)="diagnose()" [disabled]="enriching()">
                    <mat-icon>manage_search</mat-icon> Diagnose
                  </button>
                  <button mat-menu-item (click)="enrich()" [disabled]="enriching()">
                    @if (enriching()) {
                      <mat-spinner diameter="16" style="display:inline-block;margin-right:6px" />
                    } @else {
                      <mat-icon>auto_awesome</mat-icon>
                    }
                    Enrich
                  </button>
                }
                @if (isAdmin()) {
                  <button mat-menu-item class="delete-item" (click)="deleteRestaurant()">
                    <mat-icon color="warn">delete</mat-icon> Delete
                  </button>
                }
              </mat-menu>
              <input
                #photoInput
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style="display:none"
                (change)="onPhotoFile($event)"
              />
            </div>
          }
        </div>

        <!-- Photo gallery -->
        @if (restaurant()!.photos.length > 0) {
          <div class="gallery">
            @for (photo of restaurant()!.photos; track photo.id) {
              <div class="gallery-item">
                <img [src]="photo.filePath" [alt]="restaurant()!.name" />
                @if (isAdminOrMod()) {
                  <button
                    mat-icon-button
                    class="delete-photo-btn"
                    (click)="deletePhoto(photo.id)"
                    aria-label="Delete photo"
                  >
                    <mat-icon>close</mat-icon>
                  </button>
                }
              </div>
            }
          </div>
        }

        <!-- Info -->
        <mat-card class="info-card">
          <mat-card-header>
            <mat-card-title>{{ restaurant()!.name }}</mat-card-title>
            <mat-card-subtitle>{{ restaurant()!.city.name }}</mat-card-subtitle>
          </mat-card-header>
          <mat-card-content class="info-body">
            <div class="info-row">
              <mat-icon>location_on</mat-icon>
              <a [href]="mapsUrl()" target="_blank" rel="noopener" class="map-link">
                {{ restaurant()!.address }}
              </a>
            </div>

            @if (restaurant()!.phone) {
              <div class="info-row">
                <mat-icon>phone</mat-icon>
                <a [href]="'tel:' + restaurant()!.phone">{{ restaurant()!.phone }}</a>
              </div>
            }

            @if (restaurant()!.websiteUrl) {
              <div class="info-row">
                <mat-icon>language</mat-icon>
                <a [href]="restaurant()!.websiteUrl!" target="_blank" rel="noopener">
                  {{ restaurant()!.websiteUrl }}
                </a>
              </div>
            }

            @if (restaurant()!.description) {
              <p class="description">{{ restaurant()!.description }}</p>
            }

            <div class="audit-info">
              @if (restaurant()!.createdByUser) {
                <div class="audit-row">
                  <img
                    class="audit-avatar"
                    [src]="restaurant()!.createdByUser!.profilePhotoPath || '/avatars/bear-chef.jpg'"
                    [alt]="restaurant()!.createdByUser!.fullName"
                  />
                  <span>Added by <strong>{{ restaurant()!.createdByUser!.fullName }}</strong>
                    on {{ restaurant()!.createdAt | date:'mediumDate' }}</span>
                </div>
              } @else {
                <div class="audit-row muted">
                  Added {{ restaurant()!.createdAt | date:'mediumDate' }}
                </div>
              }
              @if (restaurant()!.updatedByUser && restaurant()!.updatedAt !== restaurant()!.createdAt) {
                <div class="audit-row">
                  <img
                    class="audit-avatar"
                    [src]="restaurant()!.updatedByUser!.profilePhotoPath || '/avatars/bear-chef.jpg'"
                    [alt]="restaurant()!.updatedByUser!.fullName"
                  />
                  <span>Updated by <strong>{{ restaurant()!.updatedByUser!.fullName }}</strong>
                    on {{ restaurant()!.updatedAt | date:'mediumDate' }}</span>
                </div>
              }
              @if (restaurant()!.enrichedAt) {
                <div class="audit-row muted">
                  <mat-icon class="audit-icon">auto_awesome</mat-icon>
                  Enriched {{ restaurant()!.enrichedAt | date:'mediumDate' }}
                </div>
              }
            </div>
          </mat-card-content>
        </mat-card>
      </div>
    } @else {
      <p class="empty">Restaurant not found.</p>
    }
  `,
  styles: [
    `
      .center {
        display: flex;
        justify-content: center;
        padding: 64px;
      }
      .detail-page {
        max-width: 860px;
        margin: 0 auto;
      }
      .top-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
        flex-wrap: wrap;
        gap: 8px;
      }
      .actions {
        display: flex;
        gap: 4px;
        align-items: center;
      }
      .delete-item { color: #c62828; }
      .gallery {
        display: flex;
        gap: 8px;
        overflow-x: auto;
        margin-bottom: 20px;
        padding-bottom: 4px;
      }
      .gallery-item {
        position: relative;
        flex-shrink: 0;
        width: 220px;
        height: 160px;
        border-radius: 8px;
        overflow: hidden;
        background: var(--db-cream-dark);
        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
      }
      .delete-photo-btn {
        position: absolute;
        top: 4px;
        right: 4px;
        background: rgba(0, 0, 0, 0.55);
        color: white;
        width: 28px;
        height: 28px;
        line-height: 28px;
        mat-icon {
          font-size: 16px;
        }
      }
      .info-card {
        margin-bottom: 24px;
      }
      .info-body {
        padding: 8px 0 0;
      }
      .info-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin-bottom: 10px;
        font-size: 0.95rem;
        mat-icon {
          color: var(--db-primary);
          margin-top: 2px;
          flex-shrink: 0;
        }
        a {
          color: inherit;
          text-decoration: none;
          &:hover {
            text-decoration: underline;
          }
        }
      }
      .map-link {
        color: var(--db-primary);
      }
      .description {
        margin: 16px 0 0;
        line-height: 1.6;
        color: #444;
      }
      .empty {
        text-align: center;
        color: #999;
        padding: 48px 0;
      }
      .audit-info {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid #eee;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .audit-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.82rem;
        color: #666;
        &.muted { color: #aaa; }
      }
      .audit-avatar {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
      }
      .audit-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--db-primary);
      }
    `,
  ],
})
export class RestaurantDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly restaurantsService = inject(RestaurantsService);
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  @ViewChild('photoInput') photoInputRef!: ElementRef<HTMLInputElement>;

  readonly restaurant = signal<Restaurant | null>(null);
  readonly loading = signal(true);
  readonly enriching = signal(false);

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.restaurantsService.getOne(id).subscribe({
      next: (r) => {
        this.restaurant.set(r);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        void this.router.navigate(['/restaurants']);
      },
    });
  }

  isAdminOrMod(): boolean {
    const role = this.authService.currentUser()?.role;
    return role === 'admin' || role === 'moderator';
  }

  isAdmin(): boolean {
    return this.authService.currentUser()?.role === 'admin';
  }

  mapsUrl(): string {
    return this.restaurantsService.googleMapsUrl(this.restaurant()!) ?? '#';
  }

  createEvent(): void {
    const r = this.restaurant()!;
    const ref = this.dialog.open(EventFormDialogComponent, {
      data: {
        preset: {
          cityId: r.cityId,
          restaurantId: r.id,
          title: `Bear Dinner at ${r.name}`,
        },
      },
      width: '600px',
    });
    ref.afterClosed().subscribe((created: DinnerEvent | undefined) => {
      if (created) void this.router.navigate(['/events', created.id]);
    });
  }

  openEdit(): void {
    const ref = this.dialog.open(RestaurantFormDialogComponent, {
      data: { restaurant: this.restaurant() },
    });
    ref.afterClosed().subscribe((updated: Restaurant | undefined) => {
      if (updated) {
        this.restaurantsService.getOne(updated.id).subscribe((r) => this.restaurant.set(r));
      }
    });
  }

  openAddPhoto(): void {
    this.photoInputRef.nativeElement.click();
  }

  onPhotoFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const ref = this.dialog.open(PhotoCropDialogComponent, {
      data: { file, shape: 'rectangle' },
      disableClose: true,
      maxWidth: '95vw',
    });

    ref.afterClosed().subscribe((blob: Blob | null) => {
      if (!blob) return;
      const cropped = new File([blob], 'photo.jpg', { type: 'image/jpeg' });
      const id = this.restaurant()!.id;
      this.restaurantsService.addPhoto(id, cropped).subscribe({
        next: () => {
          this.snackBar.open('Photo added', 'OK', { duration: 3000 });
          this.restaurantsService.getOne(id).subscribe((r) => this.restaurant.set(r));
        },
        error: () => this.snackBar.open('Upload failed', 'OK', { duration: 3000 }),
      });
    });
  }

  diagnose(): void {
    const id = this.restaurant()!.id;
    this.enriching.set(true);
    this.restaurantsService.diagnose(id).subscribe({
      next: (result) => {
        this.enriching.set(false);
        this.dialog.open(EnrichDiagnoseDialogComponent, {
          data: result,
          maxWidth: '700px',
          width: '95vw',
        });
      },
      error: () => {
        this.enriching.set(false);
        this.snackBar.open('Diagnose failed', 'OK', { duration: 3000 });
      },
    });
  }

  enrich(): void {
    const id = this.restaurant()!.id;
    this.enriching.set(true);
    this.restaurantsService.enrich(id).subscribe({
      next: (res) => {
        this.restaurant.set(res.restaurant);
        this.enriching.set(false);
        const parts: string[] = [];
        if (res.placeFound) parts.push('found on Google Places');
        if (res.description) parts.push('description added');
        if (res.phone) parts.push('phone added');
        if (res.website) parts.push('website added');
        if (res.photoAdded) parts.push('photo added');
        const msg = parts.length ? parts.join(', ') : 'nothing new to add';
        this.snackBar.open(`Enriched: ${msg}`, 'OK', { duration: 5000 });
      },
      error: () => {
        this.enriching.set(false);
        this.snackBar.open('Enrichment failed', 'OK', { duration: 3000 });
      },
    });
  }

  deleteRestaurant(): void {
    const r = this.restaurant()!;
    if (!window.confirm(`Delete "${r.name}"? This cannot be undone.`)) return;
    this.restaurantsService.delete(r.id).subscribe({
      next: () => void this.router.navigate(['/restaurants']),
      error: () => this.snackBar.open('Delete failed', 'OK', { duration: 3000 }),
    });
  }

  deletePhoto(photoId: number): void {
    const id = this.restaurant()!.id;
    this.restaurantsService.deletePhoto(id, photoId).subscribe({
      next: () => {
        this.restaurant.update((r) =>
          r ? { ...r, photos: r.photos.filter((p) => p.id !== photoId) } : r,
        );
        this.snackBar.open('Photo removed', 'OK', { duration: 3000 });
      },
    });
  }
}
