import {
  Component,
  computed,
  effect,
  inject,
  OnInit,
  signal,
  HostListener,
  ChangeDetectionStrategy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';
import { CityService } from '../../core/services/city.service';
import { isElevatedRole } from '../../core/utils/roles.util';

interface Member {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
  selectedTitle: string | null;
  cityId: number;
  cityName: string | null;
  joinedAt: string;
  isNew: boolean;
  totalPoints: number;
  invitedBy: { id: number; fullName: string; profilePhotoPath: string | null } | null;
  role?: string;
  status?: string;
  hasFacebook?: boolean;
  facebookProfileUrl?: string | null;
  googleEmail?: string | null;
}

@Component({
  selector: 'app-members',
  standalone: true,
  imports: [
    RouterLink,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="members-container">
      <div class="members-header">
        <h2>Members ({{ filtered().length }})</h2>
        <div class="filters">
          <mat-form-field appearance="outline" class="search-field">
            <mat-label>Search</mat-label>
            <input matInput (input)="onSearch($event)" placeholder="Search by name…" />
          </mat-form-field>
          <mat-form-field appearance="outline" class="sort-field">
            <mat-label>Sort</mat-label>
            <mat-select [value]="sort()" (selectionChange)="setSort($event.value)">
              <mat-option value="newest">Newest First</mat-option>
              <mat-option value="alpha">Alphabetical</mat-option>
            </mat-select>
          </mat-form-field>
          @if (!cityService.isSingleCity()) {
            <mat-form-field appearance="outline" class="city-field">
              <mat-label>City</mat-label>
              <mat-select [value]="cityFilter()" (selectionChange)="cityFilter.set($event.value)">
                <mat-option [value]="null">All Cities</mat-option>
                @for (city of cityService.cities(); track city.id) {
                  <mat-option [value]="city.id">{{ city.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }
          @if (showRoles()) {
            <mat-form-field appearance="outline" class="role-field">
              <mat-label>Role</mat-label>
              <mat-select [value]="roleFilter()" (selectionChange)="roleFilter.set($event.value)">
                <mat-option value="">All roles</mat-option>
                <mat-option value="member">Member</mat-option>
                <mat-option value="moderator">Moderator</mat-option>
                <mat-option value="admin">Admin</mat-option>
              </mat-select>
            </mat-form-field>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="40" /></div>
      } @else if (isNonValidated()) {
        <p class="mystery-hint">
          Member profiles are visible to full members. Get vouched in to see who's here!
        </p>
        <div class="members-grid">
          @for (member of members(); track member.id) {
            <div class="member-card mystery-card">
              <div class="avatar avatar-mystery">
                <img src="/assets/default-avatar.svg" alt="Mystery member" />
              </div>
              <div class="member-info">
                <span class="member-name mystery-name">Mystery Bear</span>
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="members-grid">
          @for (member of filtered(); track member.id) {
            <a class="member-card" [routerLink]="['/members', member.id]">
              @if (member.totalPoints > 0) {
                <div class="paw-badge">
                  <svg viewBox="0 0 56 54" xmlns="http://www.w3.org/2000/svg" class="paw-svg">
                    <circle cx="10" cy="20" r="7" fill="#8B5E3C" />
                    <circle cx="21" cy="13" r="7" fill="#8B5E3C" />
                    <circle cx="35" cy="13" r="7" fill="#8B5E3C" />
                    <circle cx="46" cy="20" r="7" fill="#8B5E3C" />
                    <circle cx="28" cy="38" r="14" fill="#8B5E3C" />
                    <text
                      x="28"
                      y="38"
                      text-anchor="middle"
                      dominant-baseline="central"
                      fill="white"
                      font-size="13"
                      font-weight="800"
                      font-family="system-ui,sans-serif"
                    >
                      {{ member.totalPoints }}
                    </text>
                  </svg>
                </div>
              }
              <div
                class="avatar"
                [class.avatar-banned]="member.status === 'suspended'"
                (click)="openLightbox(member, $event)"
              >
                @if (member.profilePhotoPath) {
                  <img [src]="member.profilePhotoPath" [alt]="member.fullName" />
                } @else {
                  <img src="/assets/default-avatar.svg" alt="Member" />
                }
              </div>
              <div class="member-info">
                <span class="member-name">
                  {{ member.fullName }}
                  @if (member.isNew) {
                    <span class="new-badge">New</span>
                  }
                </span>
                @if (member.selectedTitle) {
                  <span class="member-title">{{ member.selectedTitle }}</span>
                }
                @if (member.cityName) {
                  <span class="member-city">{{ member.cityName }}</span>
                }
                @if (showRoles() && member.role && member.role !== 'member') {
                  <mat-chip [class]="'role-' + member.role">{{ member.role }}</mat-chip>
                }
                @if (member.status === 'suspended') {
                  <mat-chip class="chip-banned">Banned</mat-chip>
                }
                @if (member.invitedBy) {
                  <span class="invited-by">↳ {{ member.invitedBy.fullName }}</span>
                }
                @if (showRoles()) {
                  <div
                    class="provider-badges"
                    (click)="$event.preventDefault(); $event.stopPropagation()"
                  >
                    @if (member.hasFacebook) {
                      @if (member.facebookProfileUrl) {
                        <a
                          [href]="member.facebookProfileUrl"
                          target="_blank"
                          rel="noopener noreferrer"
                          class="provider-badge badge-fb"
                          title="View Facebook profile"
                          (click)="$event.stopPropagation()"
                          >fb</a
                        >
                      } @else {
                        <span class="provider-badge badge-fb" title="Facebook connected">fb</span>
                      }
                    }
                    @if (member.googleEmail) {
                      <a
                        [href]="
                          'https://mail.google.com/mail/?view=cm&fs=1&to=' + member.googleEmail
                        "
                        target="_blank"
                        rel="noopener noreferrer"
                        class="provider-badge badge-g"
                        title="Send Gmail to {{ member.googleEmail }}"
                        (click)="$event.stopPropagation()"
                        >G</a
                      >
                    }
                  </div>
                }
              </div>
            </a>
          }
        </div>
      }
    </div>

    @if (lightboxSrc()) {
      <div class="lightbox" (click)="lightboxSrc.set(null)" role="dialog" aria-modal="true">
        <div class="lightbox-inner" (click)="$event.stopPropagation()">
          <img [src]="lightboxSrc()!" [alt]="lightboxName()" class="lightbox-img" />
          <p class="lightbox-name">{{ lightboxName() }}</p>
          <button class="lightbox-close" (click)="lightboxSrc.set(null)" aria-label="Close">
            ✕
          </button>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .members-container {
        max-width: 1100px;
        margin: 0 auto;
        padding: 16px;
      }
      .members-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
        h2 {
          margin: 0;
        }
      }
      .filters {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        align-items: center;
      }
      .search-field {
        width: 220px;
      }
      .sort-field {
        width: 160px;
      }
      .role-field {
        width: 160px;
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .members-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 16px;
      }
      .member-card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
        padding: 20px 12px;
        border-radius: 12px;
        background: #fff;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
        text-align: center;
        text-decoration: none;
        color: inherit;
        transition:
          box-shadow 0.15s,
          transform 0.15s;
        cursor: pointer;
        &:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          transform: translateY(-2px);
        }
      }
      .paw-badge {
        position: absolute;
        top: 6px;
        right: 6px;
      }
      .paw-svg {
        width: 46px;
        height: 46px;
        filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.18));
      }
      .avatar {
        width: 108px;
        height: 108px;
        border-radius: 14px;
        overflow: hidden;
        background: #f0f0f0;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        cursor: zoom-in;
        transition: box-shadow 0.15s;
        &:hover {
          box-shadow: 0 0 0 3px var(--db-amber);
        }
        img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          object-position: center top;
        }
      }
      .avatar-banned {
        opacity: 0.5;
        filter: grayscale(1);
      }
      .avatar-fallback {
        font-size: 2rem;
      }
      .lightbox {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.72);
        z-index: 1200;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        animation: fadeIn 0.15s ease;
      }
      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      .lightbox-inner {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        cursor: default;
      }
      .lightbox-img {
        width: min(80vw, 480px);
        height: min(80vw, 480px);
        object-fit: cover;
        object-position: center top;
        border-radius: 16px;
        box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
      }
      .lightbox-name {
        color: #fff;
        font-size: 1.1rem;
        font-weight: 600;
        margin: 0;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
      }
      .lightbox-close {
        position: absolute;
        top: -14px;
        right: -14px;
        background: rgba(255, 255, 255, 0.15);
        border: none;
        color: #fff;
        width: 32px;
        height: 32px;
        border-radius: 50%;
        font-size: 1rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        &:hover {
          background: rgba(255, 255, 255, 0.3);
        }
      }
      .member-info {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
      }
      .member-name {
        font-weight: 500;
        font-size: 0.9rem;
      }
      .member-city {
        font-size: 0.75rem;
        color: #888;
      }
      .invited-by {
        font-size: 0.7rem;
        color: #bbb;
        font-style: italic;
      }
      mat-chip {
        font-size: 0.7rem !important;
        min-height: 20px !important;
      }
      .role-admin {
        --mat-chip-label-text-color: #fff;
        background: var(--db-primary) !important;
      }
      .role-moderator {
        --mat-chip-label-text-color: #fff;
        background: var(--db-primary) !important;
      }
      .chip-banned {
        background: #ffccbc !important;
      }
      .mystery-hint {
        color: #888;
        font-size: 0.85rem;
        font-style: italic;
        margin-bottom: 16px;
      }
      .mystery-card {
        cursor: default;
        pointer-events: none;
        &:hover {
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
          transform: none;
        }
      }
      .avatar-mystery {
        filter: grayscale(1);
        opacity: 0.45;
        cursor: default;
        &:hover {
          box-shadow: none;
        }
      }
      .mystery-name {
        color: #bbb;
        font-style: italic;
      }
      .new-badge {
        font-size: 0.62rem;
        font-weight: 700;
        background: var(--db-primary);
        color: #fff;
        border-radius: 10px;
        padding: 1px 7px;
        letter-spacing: 0.04em;
        vertical-align: middle;
      }
      .member-title {
        font-size: 0.72rem;
        color: var(--db-primary);
        font-style: italic;
      }
      .provider-badges {
        display: flex;
        gap: 6px;
        justify-content: center;
        margin-top: 6px;
      }
      .provider-badge {
        font-size: 0.75rem;
        font-weight: 700;
        padding: 3px 10px;
        border-radius: 20px;
        text-decoration: none;
        letter-spacing: 0.03em;
        display: inline-flex;
        align-items: center;
      }
      .badge-fb {
        background: #1877f2;
        color: #fff;
      }
      .badge-g {
        background: #ea4335;
        color: #fff;
      }
    `,
  ],
})
export class MembersComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  readonly cityService = inject(CityService);

  readonly loading = signal(true);
  readonly members = signal<Member[]>([]);
  readonly query = signal('');
  readonly sort = signal<'newest' | 'alpha'>('newest');
  readonly roleFilter = signal('');
  readonly cityFilter = signal<number | null>(null);
  readonly lightboxSrc = signal<string | null>(null);
  readonly lightboxName = signal<string | null>(null);

  readonly isNonValidated = computed(
    () => this.authService.currentUser()?.role === 'non_validated',
  );

  readonly showRoles = computed(() => {
    const role = this.authService.currentUser()?.role;
    return isElevatedRole(role);
  });

  private citySeeded = false;
  private readonly seedCityEffect = effect(() => {
    const current = this.cityService.currentCity();
    if (current && !this.citySeeded && this.cityFilter() === null) {
      this.citySeeded = true;
      this.cityFilter.set(current.id);
    }
  });

  readonly filtered = computed(() => {
    const q = this.query().toLowerCase();
    const r = this.roleFilter();
    const c = this.cityFilter();
    return this.members().filter((m) => {
      if (q && !m.fullName.toLowerCase().includes(q)) return false;
      if (r && m.role !== r) return false;
      if (c && m.cityId !== c) return false;
      return true;
    });
  });

  ngOnInit(): void {
    this.loadMembers();
  }

  loadMembers(): void {
    this.loading.set(true);
    this.http.get<Member[]>(`/api/v1/users/members?sort=${this.sort()}`).subscribe({
      next: (members) => {
        this.members.set(members);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  setSort(value: 'newest' | 'alpha'): void {
    this.sort.set(value);
    this.loadMembers();
  }

  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value.trim());
  }

  openLightbox(member: Member, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const src = member.profilePhotoPath ?? '/assets/default-avatar.svg';
    this.lightboxSrc.set(src);
    this.lightboxName.set(member.fullName);
  }

  @HostListener('document:keydown.escape')
  closeLightbox(): void {
    this.lightboxSrc.set(null);
  }
}
