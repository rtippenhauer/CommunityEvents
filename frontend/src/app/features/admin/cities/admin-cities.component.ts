import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';

interface City {
  id: number;
  name: string;
  subdomain: string;
  isActive: boolean;
}

interface AdminUser {
  id: number;
  cityId: number;
  status: string;
  role: string;
}

interface CityRow extends City {
  totalMembers: number;
  activeMembers: number;
}

@Component({
  selector: 'app-admin-cities',
  standalone: true,
  imports: [MatProgressSpinnerModule, MatChipsModule],
  template: `
    <div class="cities-container">
      <h2>Cities</h2>

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
    h2 { margin: 0 0 20px; }
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
    }
    .city-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      h3 { margin: 0; font-size: 1.1rem; }
    }
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

  readonly loading = signal(true);
  readonly cityRows = signal<CityRow[]>([]);

  ngOnInit(): void {
    Promise.all([
      this.http.get<City[]>('/api/v1/cities').toPromise(),
      this.http.get<AdminUser[]>('/api/v1/admin/users').toPromise(),
    ]).then(([cities, users]) => {
      const cityList = cities ?? [];
      const userList = users ?? [];
      this.cityRows.set(cityList.map((city) => {
        const cityUsers = userList.filter((u) => u.cityId === city.id && u.status !== 'deleted');
        return {
          ...city,
          totalMembers: cityUsers.length,
          activeMembers: cityUsers.filter((u) => u.status === 'active').length,
        };
      }));
      this.loading.set(false);
    }).catch(() => this.loading.set(false));
  }
}
