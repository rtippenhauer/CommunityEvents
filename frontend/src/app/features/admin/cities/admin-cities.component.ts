import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminCity, CitiesAdminService } from '../../../core/services/cities-admin.service';
import { CityFormDialogComponent, CityFormDialogData } from './city-form-dialog.component';
import {
  RetireCityDialogComponent,
  RetireCityDialogData,
} from './retire-city-dialog.component';
import { BrandConfigService } from '../../../core/services/brand-config.service';
import { CityService } from '../../../core/services/city.service';

interface AdminUser {
  id: number;
  cityId: number | null;
  status: string;
  role: string;
}

interface CityRow extends AdminCity {
  totalMembers: number;
  activeMembers: number;
}

@Component({
  selector: 'app-admin-cities',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatSlideToggleModule,
    MatTooltipModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="cities-container">
      <div class="cities-header">
        <h2>Cities</h2>
        <button mat-raised-button color="primary" (click)="openCreate()">
          <mat-icon>add</mat-icon> Add city
        </button>
      </div>

      <!--
        The toggle lives here rather than on Site Settings with the other
        feature switches, because it is the only one that rewrites data: on
        backfills every event, venue and member with no city, off clears them
        and retires every city. The API refuses this key through the ordinary
        settings endpoint for the same reason.
      -->
      <div class="feature-card">
        <mat-slide-toggle
          [checked]="enabled()"
          [disabled]="togglingFeature()"
          (change)="setFeature($event.checked)"
        >
          Filter {{ brand.dinnerPluralLower() }} by city
        </mat-slide-toggle>
        <p class="feature-hint">
          @if (enabled()) {
            Every {{ brand.dinnerSingularLower() }}, {{ brand.locationSingularLower() }} and member
            belongs to a city, and members choose which cities they want to see and hear about.
            Turning this off clears those and retires every city — past
            {{ brand.dinnerPluralLower() }} keep theirs.
          } @else {
            Cities are hidden everywhere and nothing asks for one. Turning this on files everything
            that has no city under your first one.
          }
        </p>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="36" /></div>
      } @else if (!cityRows().length) {
        <p class="empty">
          No cities yet. Add one to start filing {{ brand.dinnerPluralLower() }} by where they
          happen.
        </p>
      } @else {
        <div class="cities-grid">
          @for (city of cityRows(); track city.id) {
            <div class="city-card" [class.retired]="!city.isActive">
              <div class="city-header">
                <h3>{{ city.name }}</h3>
                @if (!city.isActive) {
                  <mat-chip class="chip-inactive">Retired</mat-chip>
                }
              </div>

              <div class="city-stats">
                <div class="stat">
                  <span class="stat-value">{{ city.totalMembers }}</span>
                  <span class="stat-label">Members</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ city.activeMembers }}</span>
                  <span class="stat-label">Active</span>
                </div>
              </div>

              <div class="city-actions">
                <button mat-button (click)="openEdit(city)">
                  <mat-icon>edit</mat-icon> Rename
                </button>
                @if (city.isActive) {
                  <button
                    mat-button
                    (click)="openRetire(city)"
                    matTooltip="Stops offering it. Nothing is deleted and past
                      {{ brand.dinnerPluralLower() }} keep it."
                  >
                    <mat-icon>archive</mat-icon> Retire
                  </button>
                } @else {
                  <button mat-button (click)="restore(city)">
                    <mat-icon>unarchive</mat-icon> Restore
                  </button>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .cities-container {
        max-width: 900px;
        margin: 0 auto;
        padding: 16px;
      }
      .cities-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
        margin-bottom: 20px;
      }
      h2 {
        margin: 0;
      }
      .feature-card {
        background: var(--ce-surface);
        border: 1px solid var(--ce-rule);
        border-radius: 12px;
        padding: 16px 20px;
        margin-bottom: 24px;
      }
      .feature-hint {
        margin: 10px 0 0;
        font-size: 0.85rem;
        line-height: 1.55;
        color: var(--ce-text-muted);
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .empty {
        color: var(--ce-text-muted);
        font-size: 0.9rem;
        text-align: center;
        padding: 32px 0;
      }
      .cities-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 16px;
      }
      .city-card {
        background: var(--ce-surface);
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.1);
      }
      .city-card.retired {
        opacity: 0.72;
      }
      .city-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
        h3 {
          margin: 0;
          font-size: 1.1rem;
        }
      }
      .city-stats {
        display: flex;
        gap: 24px;
        margin-bottom: 12px;
      }
      .stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
      }
      .stat-value {
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--ce-primary);
      }
      .stat-label {
        font-size: 0.75rem;
        color: var(--ce-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .city-actions {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
        border-top: 1px solid var(--ce-rule);
        padding-top: 8px;
      }
      mat-chip {
        font-size: 0.7rem !important;
        min-height: 20px !important;
      }
      .chip-inactive {
        background: var(--ce-surface-variant) !important;
      }
      @media (max-width: 480px) {
        .cities-grid {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class AdminCitiesComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly citiesAdminService = inject(CitiesAdminService);
  private readonly cityService = inject(CityService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  readonly brand = inject(BrandConfigService);

  readonly loading = signal(true);
  readonly enabled = signal(false);
  readonly togglingFeature = signal(false);
  private readonly cities = signal<AdminCity[]>([]);
  private readonly users = signal<AdminUser[]>([]);
  readonly cityRows = signal<CityRow[]>([]);

  ngOnInit(): void {
    this.refresh();
  }

  private refresh(): void {
    this.loading.set(true);
    Promise.all([
      this.citiesAdminService.getAll().toPromise(),
      this.http.get<AdminUser[]>('/api/v1/admin/users').toPromise(),
    ])
      .then(([response, users]) => {
        this.cities.set(response?.cities ?? []);
        this.enabled.set(response?.enabled ?? false);
        this.users.set(users ?? []);
        this.buildRows();
        this.loading.set(false);
        // The member-facing list is cached in a signal at app start, so every
        // picker in the app keeps offering a city this screen just retired
        // until it is reloaded.
        this.cityService.load();
      })
      .catch(() => this.loading.set(false));
  }

  private buildRows(): void {
    const userList = this.users();
    this.cityRows.set(
      this.cities().map((city) => {
        const cityUsers = userList.filter((u) => u.cityId === city.id && u.status !== 'deleted');
        return {
          ...city,
          totalMembers: cityUsers.length,
          activeMembers: cityUsers.filter((u) => u.status === 'active').length,
        };
      }),
    );
  }

  setFeature(enabled: boolean): void {
    this.togglingFeature.set(true);
    this.citiesAdminService.setFeature(enabled).subscribe({
      next: () => {
        this.togglingFeature.set(false);
        this.snackBar.open(
          enabled ? 'City filtering is on.' : 'City filtering is off.',
          'OK',
          { duration: 3000 },
        );
        // A full reload, not just a flag flip: the toggle moved rows, so the
        // counts and the active/retired state on every card are now wrong.
        this.refresh();
      },
      error: (err: HttpErrorResponse) => {
        this.togglingFeature.set(false);
        this.report(err, 'Could not change that setting');
        // Puts the switch back as a side effect of re-reading the real state,
        // which is the only thing that knows whether the write landed. The
        // common failure here is deliberate — turning it on with no city — and
        // the toggle snapping back is the honest answer to that.
        this.refresh();
      },
    });
  }

  openCreate(): void {
    this.openDialog({});
  }

  openEdit(city: AdminCity): void {
    this.openDialog({ city });
  }

  openRetire(city: AdminCity): void {
    const data: RetireCityDialogData = {
      city,
      destinations: this.cities().filter((c) => c.isActive && c.id !== city.id),
    };
    this.dialog
      .open(RetireCityDialogComponent, { data, width: '460px' })
      .afterClosed()
      .subscribe((result) => {
        if (result) this.refresh();
      });
  }

  restore(city: AdminCity): void {
    this.citiesAdminService.reactivate(city.id).subscribe({
      next: () => this.refresh(),
      error: (err: HttpErrorResponse) => this.report(err, 'Could not restore that city'),
    });
  }

  private openDialog(data: CityFormDialogData): void {
    this.dialog
      .open(CityFormDialogComponent, { data, width: '420px' })
      .afterClosed()
      .subscribe((result) => {
        if (result) this.refresh();
      });
  }

  private report(err: HttpErrorResponse, fallback: string): void {
    const msg = err?.error?.message ?? fallback;
    this.snackBar.open(typeof msg === 'string' ? msg : fallback, 'OK', { duration: 6000 });
  }
}
