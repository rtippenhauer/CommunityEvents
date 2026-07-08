import { Component, effect, inject, OnInit, signal } from '@angular/core';
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
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { RestaurantsService, Restaurant } from '../../../core/services/restaurants.service';
import { AuthService } from '../../../core/services/auth.service';
import { CityService } from '../../../core/services/city.service';
import { RestaurantFormDialogComponent } from '../form/restaurant-form-dialog.component';
import { FacebookImportDialogComponent } from '../import/facebook-import-dialog.component';

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
    MatSnackBarModule,
  ],
  template: `
    <div class="page-header">
      <h1>{{ showArchived() ? 'Archived Restaurants' : 'Restaurants' }}</h1>
      <div class="header-actions">
        @if (isAdmin()) {
          <button mat-stroked-button (click)="toggleArchived()">
            <mat-icon>{{ showArchived() ? 'arrow_back' : 'restore_from_trash' }}</mat-icon>
            {{ showArchived() ? 'Back to Active' : 'Archived' }}
          </button>
        }
        @if (!showArchived() && isAdminOrMod()) {
          <button mat-stroked-button (click)="openImport()">
            <mat-icon>upload</mat-icon> Import
          </button>
          <button mat-stroked-button (click)="bulkEnrich()" [disabled]="enrichingAll()">
            @if (enrichingAll()) {
              <mat-spinner diameter="16" style="display:inline-block;margin-right:6px" />
            } @else {
              <mat-icon>auto_awesome</mat-icon>
            }
            Enrich All
          </button>
          <button mat-raised-button color="primary" (click)="openCreate()">
            <mat-icon>add</mat-icon> Add Restaurant
          </button>
        }
      </div>
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
      <p class="empty">{{ showArchived() ? 'No archived restaurants.' : 'No restaurants found.' }}</p>
    } @else {
      <div class="restaurant-grid">
        @for (r of restaurants(); track r.id) {
          <mat-card
            class="restaurant-card"
            [class.archived-card]="showArchived()"
            (click)="!showArchived() && goToDetail(r.id)"
            [attr.role]="showArchived() ? null : 'button'"
            [attr.tabindex]="showArchived() ? null : 0"
            (keydown.enter)="!showArchived() && goToDetail(r.id)"
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
            @if (showArchived()) {
              <mat-card-actions>
                <button mat-stroked-button color="primary" (click)="restore(r, $event)">
                  <mat-icon>restore</mat-icon> Restore
                </button>
              </mat-card-actions>
            }
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
      .header-actions {
        display: flex;
        gap: 8px;
        align-items: center;
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
      .archived-card {
        cursor: default;
        opacity: 0.75;
        &:hover {
          box-shadow: none;
          transform: none;
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
  private readonly cityService = inject(CityService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);

  readonly restaurants = signal<Restaurant[]>([]);
  readonly cities = signal<City[]>([]);
  readonly loading = signal(true);
  readonly enrichingAll = signal(false);
  readonly showArchived = signal(false);

  readonly searchCtrl = new FormControl('');
  readonly cityCtrl = new FormControl<number | null>(null);

  private citySeeded = false;
  private readonly seedCityEffect = effect(() => {
    const current = this.cityService.currentCity();
    if (current && !this.citySeeded && this.cityCtrl.value === null) {
      this.citySeeded = true;
      this.cityCtrl.setValue(current.id);
    }
  });

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
    const cityId = this.cityCtrl.value ?? undefined;
    const search = this.searchCtrl.value ?? undefined;
    const obs = this.showArchived()
      ? this.restaurantsService.getArchived(cityId, search)
      : this.restaurantsService.getAll(cityId, search);
    obs.subscribe({
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

  isAdmin(): boolean {
    return this.authService.currentUser()?.role === 'admin';
  }

  toggleArchived(): void {
    this.showArchived.set(!this.showArchived());
    this.load();
  }

  restore(r: Restaurant, event: Event): void {
    event.stopPropagation();
    this.restaurantsService.restore(r.id).subscribe({
      next: () => {
        this.snackBar.open(`${r.name} restored`, 'OK', { duration: 3000 });
        this.load();
      },
      error: () => this.snackBar.open('Failed to restore restaurant', 'OK', { duration: 3000 }),
    });
  }

  goToDetail(id: number): void {
    void this.router.navigate(['/restaurants', id]);
  }

  openCreate(): void {
    const ref = this.dialog.open(RestaurantFormDialogComponent, { data: {}, width: '560px', maxWidth: '95vw' });
    ref.afterClosed().subscribe((r: Restaurant | undefined) => {
      if (r) this.load();
    });
  }

  bulkEnrich(): void {
    const count = this.restaurants().length;
    const confirmed = window.confirm(
      `Enrich all ${count} restaurants with Google Places + Claude descriptions?\n\nThis runs in the background — check Unraid logs for progress. Takes ~${Math.ceil(count * 0.7 / 60)} minutes.`
    );
    if (!confirmed) return;
    this.enrichingAll.set(true);
    this.restaurantsService.bulkEnrich().subscribe({
      next: (res) => {
        this.enrichingAll.set(false);
        this.snackBar.open(
          `Enriching ${res.total} restaurants in background — check logs for progress`,
          'OK',
          { duration: 6000 }
        );
      },
      error: () => {
        this.enrichingAll.set(false);
        this.snackBar.open('Bulk enrich failed to start', 'OK', { duration: 3000 });
      },
    });
  }

  openImport(): void {
    const ref = this.dialog.open(FacebookImportDialogComponent, { disableClose: true });
    ref.afterClosed().subscribe((imported: boolean | undefined) => {
      if (imported) this.load();
    });
  }
}
