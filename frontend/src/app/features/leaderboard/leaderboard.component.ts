import {
  Component,
  effect,
  inject,
  OnInit,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { CommunityService, LeaderboardEntry } from '../../core/services/community.service';
import { CityService } from '../../core/services/city.service';
import { AuthService } from '../../core/services/auth.service';

const TYPE_LABELS: Record<string, string> = {
  attendance: 'Attendance',
  coordinator: 'Coordinator',
  coordinator_new_restaurant: 'Explorer',
  invite: 'Invites',
  rating: 'Ratings',
};

@Component({
  selector: 'app-leaderboard',
  standalone: true,
  imports: [
    RouterLink,
    MatSelectModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatChipsModule,
  ],
  template: `
    <div class="lb-container">
      <div class="lb-header">
        <div class="lb-title-row">
          <h2>Bear Points Leaderboard</h2>
          <mat-form-field appearance="outline" class="city-filter">
            <mat-label>City</mat-label>
            <mat-select [value]="cityFilter()" (selectionChange)="setCityFilter($event.value)">
              <mat-option [value]="null">All Cities</mat-option>
              @for (city of cities(); track city.id) {
                <mat-option [value]="city.id">{{ city.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="40" /></div>
      } @else if (entries().length === 0) {
        <p class="empty">No Bear Points awarded yet — attend a dinner to get on the board!</p>
      } @else {
        <div class="lb-table">
          <div class="lb-row lb-head">
            <span class="col-rank">#</span>
            <span class="col-member">Member</span>
            <span class="col-pts">Points</span>
            <span class="col-top">Top Category</span>
          </div>
          @for (entry of entries(); track entry.userId) {
            <a
              class="lb-row lb-entry"
              [class.lb-entry--me]="entry.userId === myId()"
              [class.lb-entry--top3]="entry.rank <= 3"
              [routerLink]="['/members', entry.userId]"
            >
              <span
                class="col-rank rank-badge"
                [class]="'rank-' + (entry.rank <= 3 ? entry.rank : 'other')"
              >
                {{ entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : entry.rank }}
              </span>
              <span class="col-member member-cell">
                <span class="avatar">
                  @if (entry.profilePhotoPath) {
                    <img [src]="entry.profilePhotoPath" [alt]="entry.fullName" />
                  } @else {
                    <img src="/avatars/bear-default.jpg" alt="Bear avatar" />
                  }
                </span>
                <span class="member-info">
                  <span class="member-name">
                    {{ entry.fullName }}
                    @if (entry.isNew) {
                      <span class="new-badge">New</span>
                    }
                  </span>
                  @if (entry.selectedTitle) {
                    <span class="member-title">{{ entry.selectedTitle }}</span>
                  }
                  <span class="member-city">{{ entry.cityName }}</span>
                </span>
              </span>
              <span class="col-pts points-val">{{ entry.totalPoints }}</span>
              <span class="col-top">
                @if (entry.topType) {
                  <span class="top-type-chip">{{ typeLabel(entry.topType) }}</span>
                }
              </span>
            </a>
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .lb-container {
        max-width: 800px;
        margin: 0 auto;
        padding: 16px;
      }
      .lb-header {
        margin-bottom: 20px;
      }
      .lb-title-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 12px;
        h2 {
          margin: 0;
        }
      }
      .city-filter {
        width: 180px;
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .empty {
        text-align: center;
        color: #888;
        padding: 40px;
      }

      .lb-table {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .lb-row {
        display: grid;
        grid-template-columns: 52px 1fr 80px 130px;
        align-items: center;
        gap: 8px;
        padding: 10px 14px;
        border-radius: 10px;
        text-decoration: none;
        color: inherit;
      }
      .lb-head {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #888;
        background: transparent;
        padding: 4px 14px;
      }
      .lb-entry {
        background: #fff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.07);
        transition:
          box-shadow 0.15s,
          transform 0.12s;
        &:hover {
          box-shadow: 0 3px 10px rgba(0, 0, 0, 0.13);
          transform: translateY(-1px);
        }
      }
      .lb-entry--me {
        outline: 2px solid #c9933a;
        background: #fffdf6;
      }
      .lb-entry--top3 {
        font-weight: 600;
      }

      .rank-badge {
        font-size: 1.25rem;
        text-align: center;
      }
      .rank-other {
        font-size: 1rem;
        font-weight: 700;
        color: #555;
      }

      .member-cell {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .avatar {
        width: 44px;
        height: 44px;
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
      .member-info {
        display: flex;
        flex-direction: column;
        gap: 1px;
      }
      .member-name {
        font-weight: 600;
        font-size: 0.95rem;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .member-title {
        font-size: 0.78rem;
        color: #c9933a;
        font-style: italic;
      }
      .member-city {
        font-size: 0.78rem;
        color: #888;
      }

      .new-badge {
        font-size: 0.65rem;
        font-weight: 700;
        background: #1e4d8c;
        color: #fff;
        border-radius: 10px;
        padding: 1px 7px;
        letter-spacing: 0.04em;
      }

      .points-val {
        font-size: 1.1rem;
        font-weight: 700;
        color: #1e4d8c;
        text-align: center;
      }
      .top-type-chip {
        font-size: 0.75rem;
        background: #eaf0fa;
        color: #1e4d8c;
        border-radius: 12px;
        padding: 3px 10px;
        font-weight: 600;
      }

      @media (max-width: 600px) {
        .lb-row {
          grid-template-columns: 40px 1fr 60px;
        }
        .col-top {
          display: none;
        }
      }
    `,
  ],
})
export class LeaderboardComponent implements OnInit {
  private readonly communityService = inject(CommunityService);
  private readonly authService = inject(AuthService);

  readonly cityService = inject(CityService);
  readonly cities = this.cityService.cities;

  readonly loading = signal(true);
  readonly entries = signal<LeaderboardEntry[]>([]);
  readonly cityFilter = signal<number | null>(null);

  readonly myId = computed(() => this.authService.currentUser()?.id ?? null);

  private citySeeded = false;
  private readonly seedCityEffect = effect(() => {
    const current = this.cityService.currentCity();
    if (current && !this.citySeeded && this.cityFilter() === null) {
      this.citySeeded = true;
      this.setCityFilter(current.id);
    }
  });

  ngOnInit(): void {
    this.load();
  }

  setCityFilter(cityId: number | null): void {
    this.cityFilter.set(cityId);
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.communityService.getLeaderboard(this.cityFilter() ?? undefined).subscribe({
      next: (entries) => {
        this.entries.set(entries);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  typeLabel(type: string): string {
    return TYPE_LABELS[type] ?? type;
  }
}
