import { Component, computed, ElementRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { EnrichDiagnoseDialogComponent } from './enrich-diagnose-dialog.component';
import {
  RestaurantsService,
  Restaurant,
  RatingsResponse,
  EligibleEvent,
} from '../../../core/services/restaurants.service';
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
    DecimalPipe,
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDialogModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatSelectModule,
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

        <!-- Ratings -->
        @if (ratingsLoading()) {
          <div class="ratings-loading"><mat-spinner diameter="24" /></div>
        } @else if (ratings()) {
          <mat-card class="ratings-card">
            <mat-card-header>
              <mat-card-title class="ratings-title">
                <mat-icon>star</mat-icon> Ratings
                @if (ratings()!.aggregate.count > 0) {
                  <span class="ratings-count">{{ ratings()!.aggregate.count }} {{ ratings()!.aggregate.count === 1 ? 'rating' : 'ratings' }}</span>
                }
              </mat-card-title>
            </mat-card-header>
            <mat-card-content>
              @if (ratings()!.aggregate.count === 0) {
                <p class="no-ratings">No ratings yet. Be the first to rate this venue!</p>
              } @else {
                <div class="rating-aggregate">
                  <div class="rating-overall">
                    <span class="overall-score">{{ ratings()!.aggregate.avgOverall | number:'1.1-1' }}</span>
                    <div class="stars-row">
                      @for (s of [1,2,3,4,5]; track s) {
                        <mat-icon class="star-icon" [class.star-filled]="s <= (ratings()!.aggregate.avgOverall ?? 0)" [class.star-half]="s > (ratings()!.aggregate.avgOverall ?? 0) && s - 0.5 <= (ratings()!.aggregate.avgOverall ?? 0)">star</mat-icon>
                      }
                    </div>
                    <span class="overall-label">Overall</span>
                  </div>
                  <div class="rating-breakdown">
                    @for (dim of ratingDimensions(); track dim.key) {
                      <div class="breakdown-row">
                        <span class="breakdown-label">{{ dim.label }}</span>
                        <div class="breakdown-bar">
                          <div class="breakdown-fill" [style.width.%]="(dim.value / 5) * 100"></div>
                        </div>
                        <span class="breakdown-score">{{ dim.value | number:'1.1-1' }}</span>
                      </div>
                    }
                  </div>
                </div>

                @if (ratings()!.reviews.length > 0) {
                  <mat-divider style="margin: 16px 0" />
                  <div class="reviews-list">
                    @for (review of ratings()!.reviews; track review.id) {
                      <div class="review-item">
                        <div class="review-header">
                          <img class="review-avatar"
                            [src]="review.memberPhoto || '/avatars/bear-chef.jpg'"
                            [alt]="review.memberName" />
                          <div>
                            <div class="review-name">{{ review.memberName }}</div>
                            <div class="review-date">{{ (review.eventDate + 'T12:00:00') | date:'MMM d, y' }}</div>
                          </div>
                          <div class="review-scores">
                            <span class="review-score">{{ ((review.food + review.service + review.valueRating + review.noise) / 4) | number:'1.1-1' }}</span>
                            <mat-icon class="review-star">star</mat-icon>
                          </div>
                        </div>
                        @if (review.comment) {
                          <p class="review-comment">{{ review.comment }}</p>
                        }
                      </div>
                    }
                  </div>
                }
              }

              <!-- Rating form for eligible events -->
              @if (!ratingSaving() && unratedEligibleEvents().length > 0) {
                <mat-divider style="margin: 16px 0" />
                @if (!showRatingForm()) {
                  <button mat-stroked-button color="primary" (click)="showRatingForm.set(true)">
                    <mat-icon>rate_review</mat-icon> Rate Your Experience
                  </button>
                } @else {
                  <div class="rating-form">
                    <h4 class="rating-form-title">Rate Your Visit</h4>

                    @if (unratedEligibleEvents().length === 1) {
                      <p class="single-visit-label">
                        Rating your visit on <strong>{{ (unratedEligibleEvents()[0].eventDate + 'T12:00:00') | date:'MMMM d, y' }}</strong>
                      </p>
                    } @else {
                      <mat-form-field appearance="outline" class="event-select">
                        <mat-label>Select your visit date</mat-label>
                        <mat-select [formControl]="ratingEventCtrl">
                          @for (e of unratedEligibleEvents(); track e.id) {
                            <mat-option [value]="e.id">{{ (e.eventDate + 'T12:00:00') | date:'MMMM d, y' }}</mat-option>
                          }
                        </mat-select>
                      </mat-form-field>
                    }

                    @for (dim of ratingFormDims; track dim.key) {
                      <div class="rating-dim">
                        <span class="rating-dim-label">{{ dim.label }}</span>
                        <div class="rating-stars">
                          @for (s of [1,2,3,4,5]; track s) {
                            <button mat-icon-button class="star-btn" (click)="setDim(dim.key, s)">
                              <mat-icon [class.star-filled]="s <= getRatingValue(dim.key)">star</mat-icon>
                            </button>
                          }
                        </div>
                        <span class="rating-dim-val">{{ getRatingValue(dim.key) }}/5</span>
                      </div>
                    }

                    <mat-form-field appearance="outline" class="rating-comment-field">
                      <mat-label>Comment (optional)</mat-label>
                      <textarea matInput [formControl]="ratingCommentCtrl" rows="3" maxlength="1000"></textarea>
                      <mat-hint align="end">{{ ratingCommentCtrl.value.length }}/1000</mat-hint>
                    </mat-form-field>

                    <div class="rating-form-actions">
                      <button mat-button (click)="showRatingForm.set(false)">Cancel</button>
                      <button mat-raised-button color="primary" (click)="submitRating()" [disabled]="!canSubmitRating()">
                        Submit Rating
                      </button>
                    </div>
                  </div>
                }
              }
            </mat-card-content>
          </mat-card>
        }

        <!-- Moderator info (admin/mod only) -->
        @if (isAdminOrMod() && (restaurant()!.moderatorNotes || restaurant()!.contactName || restaurant()!.contactPhone || restaurant()!.contactEmail)) {
          <mat-card class="mod-card">
            <mat-card-header>
              <mat-card-title class="mod-card-title">
                <mat-icon>admin_panel_settings</mat-icon> Moderator Info
              </mat-card-title>
            </mat-card-header>
            <mat-card-content class="mod-body">
              @if (restaurant()!.moderatorNotes) {
                <p class="mod-notes">{{ restaurant()!.moderatorNotes }}</p>
              }
              @if (restaurant()!.contactName || restaurant()!.contactPhone || restaurant()!.contactEmail) {
                <div class="mod-contact">
                  <div class="mod-contact-label">Contact</div>
                  @if (restaurant()!.contactName) {
                    <div class="mod-contact-row">
                      <mat-icon>person</mat-icon>
                      <span>{{ restaurant()!.contactName }}</span>
                    </div>
                  }
                  @if (restaurant()!.contactPhone) {
                    <div class="mod-contact-row">
                      <mat-icon>phone</mat-icon>
                      <a [href]="'tel:' + restaurant()!.contactPhone">{{ restaurant()!.contactPhone }}</a>
                    </div>
                  }
                  @if (restaurant()!.contactEmail) {
                    <div class="mod-contact-row">
                      <mat-icon>email</mat-icon>
                      <a [href]="'mailto:' + restaurant()!.contactEmail">{{ restaurant()!.contactEmail }}</a>
                    </div>
                  }
                </div>
              }
            </mat-card-content>
          </mat-card>
        }
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
      // ── Ratings ────────────────────────────────────────────────────────────
      .ratings-loading { display: flex; justify-content: center; padding: 24px; }
      .ratings-card { margin-bottom: 24px; }
      .ratings-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.9rem;
        mat-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; color: var(--db-amber); }
      }
      .ratings-count { font-size: 0.8rem; font-weight: 400; color: #999; }
      .no-ratings { color: #aaa; font-size: 0.88rem; margin: 0; }
      .rating-aggregate {
        display: flex;
        gap: 24px;
        flex-wrap: wrap;
        align-items: flex-start;
        margin-top: 8px;
      }
      .rating-overall {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        min-width: 80px;
      }
      .overall-score {
        font-size: 2.2rem;
        font-weight: 700;
        color: var(--db-brown-dark);
        line-height: 1;
      }
      .stars-row {
        display: flex;
        gap: 1px;
      }
      .star-icon {
        font-size: 1.1rem;
        width: 1.1rem;
        height: 1.1rem;
        color: #ddd;
        &.star-filled { color: var(--db-amber); }
      }
      .overall-label { font-size: 0.72rem; color: #999; text-transform: uppercase; letter-spacing: 0.05em; }
      .rating-breakdown { flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 8px; }
      .breakdown-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.82rem;
      }
      .breakdown-label { width: 60px; color: #666; flex-shrink: 0; }
      .breakdown-bar {
        flex: 1;
        height: 6px;
        background: #eee;
        border-radius: 3px;
        overflow: hidden;
      }
      .breakdown-fill { height: 100%; background: var(--db-amber); border-radius: 3px; }
      .breakdown-score { width: 28px; text-align: right; color: #666; }
      .reviews-list { display: flex; flex-direction: column; gap: 12px; }
      .review-item {
        padding: 12px;
        background: #faf7f2;
        border-radius: 8px;
        border: 1px solid #e8e0d6;
      }
      .review-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 6px;
      }
      .review-avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
      }
      .review-name { font-size: 0.88rem; font-weight: 600; color: var(--db-brown-dark); }
      .review-date { font-size: 0.75rem; color: #aaa; }
      .review-scores {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 2px;
        font-size: 0.9rem;
        font-weight: 700;
        color: var(--db-brown-dark);
        .review-star { font-size: 1rem; width: 1rem; height: 1rem; color: var(--db-amber); }
      }
      .review-comment { margin: 0; font-size: 0.88rem; color: #555; line-height: 1.5; }
      // ── Rating form ────────────────────────────────────────────────────────
      .rating-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        background: #faf7f2;
        border-radius: 8px;
        border: 1px solid #e8e0d6;
      }
      .rating-form-title {
        margin: 0;
        font-size: 0.88rem;
        font-weight: 600;
        color: var(--db-brown-dark);
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
      .event-select { width: 100%; font-size: 0.88rem; }
      .single-visit-label { margin: 0 0 12px; font-size: 0.88rem; color: #555; }
      .rating-dim {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .rating-dim-label {
        width: 160px;
        font-size: 0.85rem;
        color: #555;
        flex-shrink: 0;
      }
      .rating-stars { display: flex; gap: 0; }
      .star-btn {
        width: 32px !important;
        height: 32px !important;
        padding: 0 !important;
        mat-icon {
          font-size: 1.4rem;
          width: 1.4rem;
          height: 1.4rem;
          color: #ddd;
          &.star-filled { color: var(--db-amber); }
        }
      }
      .rating-dim-val { font-size: 0.8rem; color: #999; width: 28px; }
      .rating-comment-field { width: 100%; }
      .rating-form-actions { display: flex; gap: 8px; justify-content: flex-end; }

      .mod-card {
        margin-bottom: 24px;
        border: 1px solid #e8d5f5;
        background: #faf5ff;
      }
      .mod-card-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.9rem;
        color: #6a1b9a;
        mat-icon { font-size: 1.1rem; width: 1.1rem; height: 1.1rem; }
      }
      .mod-body { padding: 4px 0 0; }
      .mod-notes {
        font-size: 0.9rem;
        line-height: 1.6;
        color: #444;
        white-space: pre-wrap;
        margin: 0 0 12px;
      }
      .mod-contact { margin-top: 4px; }
      .mod-contact-label {
        font-size: 0.72rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        color: #999;
        margin-bottom: 6px;
      }
      .mod-contact-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 0.88rem;
        color: #444;
        margin-bottom: 4px;
        mat-icon { font-size: 1rem; width: 1rem; height: 1rem; color: #9c27b0; flex-shrink: 0; }
        a { color: inherit; text-decoration: none; &:hover { text-decoration: underline; } }
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

  // ── Ratings state ──────────────────────────────────────────────────────────

  readonly ratings = signal<RatingsResponse | null>(null);
  readonly ratingsLoading = signal(false);
  readonly showRatingForm = signal(false);
  readonly ratingSaving = signal(false);

  readonly ratingEventCtrl = new FormControl<number | null>(null, Validators.required);
  readonly ratingCommentCtrl = new FormControl('', { nonNullable: true });

  readonly ratingValues = signal<Record<string, number>>({ food: 0, service: 0, valueRating: 0, noise: 0 });

  readonly ratingFormDims = [
    { key: 'food', label: 'Food' },
    { key: 'service', label: 'Service' },
    { key: 'valueRating', label: 'Value' },
    { key: 'noise', label: 'Noise (1=loud, 5=quiet)' },
  ];

  readonly ratingDimensions = computed(() => {
    const agg = this.ratings()?.aggregate;
    if (!agg) return [];
    return [
      { key: 'food', label: 'Food', value: agg.avgFood ?? 0 },
      { key: 'service', label: 'Service', value: agg.avgService ?? 0 },
      { key: 'value', label: 'Value', value: agg.avgValue ?? 0 },
      { key: 'noise', label: 'Noise', value: agg.avgNoise ?? 0 },
    ];
  });

  readonly unratedEligibleEvents = computed<EligibleEvent[]>(() =>
    (this.ratings()?.eligibleEvents ?? []).filter(e => !e.alreadyRated)
  );

  setDim(key: string, value: number): void {
    this.ratingValues.update(v => ({ ...v, [key]: value }));
  }

  getRatingValue(key: string): number {
    return this.ratingValues()[key] ?? 0;
  }

  canSubmitRating(): boolean {
    const v = this.ratingValues();
    return !!this.ratingEventCtrl.value && v['food'] > 0 && v['service'] > 0 && v['valueRating'] > 0 && v['noise'] > 0;
  }

  submitRating(): void {
    if (!this.canSubmitRating()) return;
    this.ratingSaving.set(true);
    const v = this.ratingValues();
    this.restaurantsService.submitRating(this.restaurant()!.id, {
      eventId: this.ratingEventCtrl.value!,
      food: v['food'],
      service: v['service'],
      valueRating: v['valueRating'],
      noise: v['noise'],
      comment: this.ratingCommentCtrl.value.trim() || undefined,
    }).subscribe({
      next: () => {
        this.ratingSaving.set(false);
        this.showRatingForm.set(false);
        this.ratingValues.set({ food: 0, service: 0, valueRating: 0, noise: 0 });
        this.ratingCommentCtrl.setValue('');
        this.ratingEventCtrl.setValue(null);
        this.snackBar.open('Rating submitted!', 'OK', { duration: 3000 });
        this.loadRatings(this.restaurant()!.id);
      },
      error: () => {
        this.ratingSaving.set(false);
        this.snackBar.open('Failed to submit rating', 'OK', { duration: 3000 });
      },
    });
  }

  private loadRatings(restaurantId: number): void {
    this.ratingsLoading.set(true);
    this.restaurantsService.getRatings(restaurantId).subscribe({
      next: (r) => {
        this.ratings.set(r);
        this.ratingsLoading.set(false);
        if (r.eligibleEvents.filter(e => !e.alreadyRated).length > 0) {
          this.ratingEventCtrl.setValue(r.eligibleEvents.find(e => !e.alreadyRated)?.id ?? null);
        }
      },
      error: () => this.ratingsLoading.set(false),
    });
  }

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.restaurantsService.getOne(id).subscribe({
      next: (r) => {
        this.restaurant.set(r);
        this.loading.set(false);
        this.loadRatings(id);
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
