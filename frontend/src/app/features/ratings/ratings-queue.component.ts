import {
  Component,
  computed,
  inject,
  OnInit,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { RestaurantsService, RatingQueueItem } from '../../core/services/restaurants.service';

@Component({
  selector: 'app-ratings-queue',
  standalone: true,
  imports: [
    DatePipe,
    MatCardModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatChipsModule,
  ],
  template: `
    <div class="ratings-container">
      <div class="ratings-header">
        <h2 class="ratings-title">Rate Your Visits</h2>
        <p class="ratings-subtitle">Restaurants you've attended — share your experience.</p>
      </div>

      <div class="ratings-controls">
        <mat-form-field appearance="outline" class="search-field">
          <mat-label>Search restaurants</mat-label>
          <mat-icon matPrefix>search</mat-icon>
          <input matInput (input)="onSearch($event)" placeholder="Restaurant name…" />
        </mat-form-field>

        <mat-slide-toggle
          [checked]="showRated()"
          (change)="showRated.set($event.checked)"
          class="rated-toggle"
        >
          Show already rated
        </mat-slide-toggle>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="40" /></div>
      } @else if (filtered().length === 0) {
        <mat-card class="empty-card">
          <mat-card-content>
            <mat-icon class="empty-icon">star_border</mat-icon>
            @if (showRated()) {
              <p>No visits found{{ search() ? ' matching your search' : '' }}.</p>
            } @else {
              <p>All caught up! No unrated visits{{ search() ? ' matching your search' : '' }}.</p>
              <button class="show-all-link" (click)="showRated.set(true)">
                Show already rated visits
              </button>
            }
          </mat-card-content>
        </mat-card>
      } @else {
        <div class="queue-list">
          @for (item of filtered(); track item.eventId) {
            <div
              class="queue-item"
              [class.already-rated]="item.alreadyRated"
              (click)="goToRestaurant(item.restaurantId)"
            >
              <div class="item-photo">
                @if (item.restaurantPhotoUrl) {
                  <img [src]="item.restaurantPhotoUrl" [alt]="item.restaurantName" />
                } @else {
                  <div class="photo-placeholder"><mat-icon>restaurant</mat-icon></div>
                }
              </div>
              <div class="item-info">
                <span class="item-name">{{ item.restaurantName }}</span>
                <span class="item-date">{{
                  item.eventDate + 'T12:00:00' | date: 'MMMM d, y'
                }}</span>
              </div>
              <div class="item-status">
                @if (item.alreadyRated) {
                  <mat-chip class="chip-rated"> <mat-icon>star</mat-icon> Rated </mat-chip>
                } @else {
                  <mat-chip class="chip-pending"> <mat-icon>star_border</mat-icon> Rate </mat-chip>
                }
              </div>
              <mat-icon class="item-chevron">chevron_right</mat-icon>
            </div>
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .ratings-container {
        max-width: 700px;
        margin: 0 auto;
        padding: 16px;
      }
      .ratings-header {
        margin-bottom: 20px;
      }
      .ratings-title {
        margin: 0 0 4px;
        font-size: 1.4rem;
      }
      .ratings-subtitle {
        margin: 0;
        color: #888;
        font-size: 0.9rem;
      }
      .ratings-controls {
        display: flex;
        align-items: center;
        gap: 16px;
        margin-bottom: 16px;
        flex-wrap: wrap;
      }
      .search-field {
        flex: 1;
        min-width: 200px;
      }
      .rated-toggle {
        white-space: nowrap;
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .empty-card {
        text-align: center;
        padding: 32px;
        mat-card-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
      }
      .empty-icon {
        font-size: 3rem;
        width: 3rem;
        height: 3rem;
        color: #ddd;
      }
      .show-all-link {
        background: none;
        border: none;
        color: var(--db-amber);
        cursor: pointer;
        font-size: 0.9rem;
        text-decoration: underline;
        padding: 0;
      }
      .queue-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .queue-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: #fff;
        border-radius: 10px;
        border: 1px solid #eee;
        cursor: pointer;
        transition:
          box-shadow 0.15s,
          border-color 0.15s;
        &:hover {
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
          border-color: var(--db-amber);
        }
        &.already-rated {
          background: #fafafa;
        }
      }
      .item-photo {
        width: 56px;
        height: 56px;
        border-radius: 8px;
        overflow: hidden;
        flex-shrink: 0;
        background: #f0f0f0;
        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      }
      .photo-placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ccc;
      }
      .item-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }
      .item-name {
        font-weight: 500;
        font-size: 0.95rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .item-date {
        font-size: 0.8rem;
        color: #888;
      }
      .item-status {
        flex-shrink: 0;
      }
      mat-chip {
        font-size: 0.75rem !important;
        min-height: 26px !important;
        display: flex !important;
        align-items: center !important;
        gap: 4px !important;
        mat-icon {
          font-size: 0.9rem;
          width: 0.9rem;
          height: 0.9rem;
        }
      }
      .chip-rated {
        background: #c8e6c9 !important;
        color: #2e7d32 !important;
      }
      .chip-pending {
        background: #fff9c4 !important;
        color: #7a6200 !important;
      }
      .item-chevron {
        color: #ccc;
        flex-shrink: 0;
      }
    `,
  ],
})
export class RatingsQueueComponent implements OnInit {
  private readonly restaurantsService = inject(RestaurantsService);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly items = signal<RatingQueueItem[]>([]);
  readonly search = signal('');
  readonly showRated = signal(false);

  readonly filtered = computed(() => {
    const q = this.search().toLowerCase();
    return this.items().filter((item) => {
      if (!this.showRated() && item.alreadyRated) return false;
      if (q && !item.restaurantName.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  ngOnInit(): void {
    this.restaurantsService.getRatingQueue().subscribe({
      next: (items) => {
        this.items.set(items);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  goToRestaurant(id: number): void {
    void this.router.navigate(['/restaurants', id]);
  }
}
