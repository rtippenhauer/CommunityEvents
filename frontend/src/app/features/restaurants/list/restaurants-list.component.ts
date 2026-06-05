import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { SlicePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { RestaurantsService, Restaurant } from '../../../core/services/restaurants.service';
import { AuthService } from '../../../core/services/auth.service';
import { RestaurantFormDialogComponent } from '../form/restaurant-form-dialog.component';

interface City {
  id: number;
  name: string;
}

@Component({
  selector: 'app-restaurants-list',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    SlicePipe,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  template: `
    <div class="page-header">
      <h1>Restaurants</h1>
      @if (isAdminOrMod()) {
        <button mat-raised-button color="primary" (click)="openCreate()">
          <mat-icon>add</mat-icon> Add Restaurant
        </button>
      }
    </div>

    <!-- Filters -->
    <div class="filters">
      <mat-form-field appearance="outline" class="search-field">
        <mat-label>Search</mat-label>
        <mat-icon matPrefix>search</mat-icon>
        <input matInput [formControl]="searchCtrl" placeholder="Restaurant name…" />
      </mat-form-field>

      <mat-form-field appearance="outline" class="city-field">
        <mat-label>City</mat-label>
        <mat-select [formControl]="cityCtrl">
          <mat-option [value]="null">All cities</mat-option>
          @for (city of cities(); track city.id) {
            <mat-option [value]="city.id">{{ city.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </div>

    <!-- Results -->
    @if (loading()) {
      <div class="center"><mat-spinner /></div>
    } @else if (restaurants().length === 0) {
      <p class="empty">No restaurants found.</p>
    } @else {
      <div class="restaurant-grid">
        @for (r of restaurants(); track r.id) {
          <mat-card
            class="restaurant-card"
            (click)="goToDetail(r.id)"
            role="button"
            tabindex="0"
            (keydown.enter)="goToDetail(r.id)"
          >
            <div class="card-photo">
              @if (r.photos.length > 0) {
                <img [src]="r.photos[0].filePath" [alt]="r.name" />
              } @else {
                <div class="photo-placeholder">🍽️</div>
              }
            </div>
            <mat-card-content class="card-body">
              <h3 class="restaurant-name">{{ r.name }}</h3>
              <p class="restaurant-city">{{ r.city.name }}</p>
              <p class="restaurant-address">{{ r.address }}</p>
              @if (r.description) {
                <p class="restaurant-desc">
                  {{ r.description | slice: 0 : 120 }}{{ r.description.length > 120 ? '…' : '' }}
                </p>
              }
            </mat-card-content>
          </mat-card>
        }
      </div>
    }
  `,
  styles: [
    `
      .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
        h1 {
          margin: 0;
          font-size: 1.75rem;
          color: var(--db-brown-dark);
        }
      }
      .filters {
        display: flex;
        gap: 12px;
        margin-bottom: 24px;
        flex-wrap: wrap;
      }
      .search-field {
        flex: 1;
        min-width: 200px;
      }
      .city-field {
        width: 180px;
      }
      .restaurant-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 20px;
      }
      .restaurant-card {
        cursor: pointer;
        transition:
          box-shadow 0.2s,
          transform 0.15s;
        overflow: hidden;
        &:hover {
          box-shadow: 0 6px 20px rgba(61, 28, 5, 0.18);
          transform: translateY(-2px);
        }
      }
      .card-photo {
        height: 180px;
        overflow: hidden;
        background: var(--db-cream-dark);
        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }
      }
      .photo-placeholder {
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 3rem;
      }
      .card-body {
        padding: 12px 16px 16px;
      }
      .restaurant-name {
        margin: 0 0 4px;
        font-size: 1.1rem;
        font-weight: 600;
        color: var(--db-brown-dark);
      }
      .restaurant-city {
        margin: 0 0 4px;
        font-size: 0.8rem;
        color: var(--db-primary);
        font-weight: 500;
      }
      .restaurant-address {
        margin: 0 0 8px;
        font-size: 0.85rem;
        color: #666;
      }
      .restaurant-desc {
        margin: 0;
        font-size: 0.85rem;
        color: #555;
        line-height: 1.4;
      }
      .center {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .empty {
        text-align: center;
        color: #999;
        padding: 48px 0;
      }
    `,
  ],
})
export class RestaurantsListComponent implements OnInit {
  private readonly restaurantsService = inject(RestaurantsService);
  private readonly authService = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  readonly restaurants = signal<Restaurant[]>([]);
  readonly cities = signal<City[]>([]);
  readonly loading = signal(true);

  readonly searchCtrl = new FormControl('');
  readonly cityCtrl = new FormControl<number | null>(null);

  ngOnInit(): void {
    this.http.get<City[]>('/api/v1/cities').subscribe((c) => this.cities.set(c));
    this.load();

    this.searchCtrl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged())
      .subscribe(() => this.load());
    this.cityCtrl.valueChanges.subscribe(() => this.load());
  }

  load(): void {
    this.loading.set(true);
    this.restaurantsService
      .getAll(this.cityCtrl.value ?? undefined, this.searchCtrl.value ?? undefined)
      .subscribe({
        next: (r) => {
          this.restaurants.set(r);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  isAdminOrMod(): boolean {
    const role = this.authService.currentUser()?.role;
    return role === 'admin' || role === 'moderator';
  }

  goToDetail(id: number): void {
    void this.router.navigate(['/restaurants', id]);
  }

  openCreate(): void {
    const ref = this.dialog.open(RestaurantFormDialogComponent, { data: {} });
    ref.afterClosed().subscribe((r: Restaurant | undefined) => {
      if (r) this.load();
    });
  }
}
