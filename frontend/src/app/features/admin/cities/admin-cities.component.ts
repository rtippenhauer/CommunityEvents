import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { AdminCity, CitiesAdminService } from '../../../core/services/cities-admin.service';
import { CityFormDialogComponent, CityFormDialogData } from './city-form-dialog.component';

interface AdminUser {
  id: number;
  cityId: number;
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
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatProgressSpinnerModule, MatChipsModule],
  template: `
    <div class="cities-container">
      <div class="cities-header">
        <h2>Cities</h2>
        <button mat-raised-button color="primary" (click)="openCreate()">
          <mat-icon>add</mat-icon> Add City
        </button>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="36" /></div>
      } @else {
        <div class="cities-grid">
          @for (city of cityRows(); track city.id) {
            <div class="city-card">
              <div class="city-header">
                <h3>{{ city.name }}</h3>
                @if (!city.isActive) {
                  <mat-chip class="chip-inactive">Inactive</mat-chip>
                }
                <button mat-icon-button class="edit-btn" (click)="openEdit(city)" aria-label="Edit city">
                  <mat-icon>edit</mat-icon>
                </button>
              </div>
              <div class="city-subdomain">{{ city.subdomain }}.dinnerbears.com</div>
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
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .cities-container { max-width: 900px; margin: 0 auto; padding: 16px; }
    .cities-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 20px;
    }
    h2 { margin: 0; }
    .loading { display: flex; justify-content: center; padding: 48px; }
    .cities-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 16px;
    }
    .city-card {
      background: #fff;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 1px 6px rgba(0,0,0,.1);
      position: relative;
    }
    .city-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      h3 { margin: 0; font-size: 1.1rem; }
    }
    .edit-btn { margin-left: auto; }
    .city-subdomain { color: #888; font-size: 0.8rem; margin-bottom: 16px; font-family: monospace; }
    .city-stats { display: flex; gap: 24px; }
    .stat { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .stat-value { font-size: 1.5rem; font-weight: 700; color: #1E4D8C; }
    .stat-label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.04em; }
    mat-chip { font-size: 0.7rem !important; min-height: 20px !important; }
    .chip-inactive { background: #eeeeee !important; }
  `],
})
export class AdminCitiesComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly citiesAdminService = inject(CitiesAdminService);
  private readonly dialog = inject(MatDialog);

  readonly loading = signal(true);
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
    ]).then(([cities, users]) => {
      this.cities.set(cities ?? []);
      this.users.set(users ?? []);
      this.buildRows();
      this.loading.set(false);
    }).catch(() => this.loading.set(false));
  }

  private buildRows(): void {
    const userList = this.users();
    this.cityRows.set(this.cities().map((city) => {
      const cityUsers = userList.filter((u) => u.cityId === city.id && u.status !== 'deleted');
      return {
        ...city,
        totalMembers: cityUsers.length,
        activeMembers: cityUsers.filter((u) => u.status === 'active').length,
      };
    }));
  }

  openCreate(): void {
    this.openDialog({});
  }

  openEdit(city: AdminCity): void {
    this.openDialog({ city });
  }

  private openDialog(data: CityFormDialogData): void {
    this.dialog.open(CityFormDialogComponent, { data, width: '420px' })
      .afterClosed()
      .subscribe((result) => {
        if (result) this.refresh();
      });
  }
}
