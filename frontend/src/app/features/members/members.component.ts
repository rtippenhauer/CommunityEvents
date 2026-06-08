import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../core/services/auth.service';

interface Member {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
  cityId: number;
  cityName: string | null;
  joinedAt: string;
  invitedBy: { id: number; fullName: string; profilePhotoPath: string | null } | null;
  role?: string;
  status?: string;
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
      } @else {
        <div class="members-grid">
          @for (member of filtered(); track member.id) {
            <a class="member-card" [routerLink]="['/members', member.id]">
              <div class="avatar" [class.avatar-banned]="member.status === 'suspended'">
                @if (member.profilePhotoPath) {
                  <img [src]="member.profilePhotoPath" [alt]="member.fullName" />
                } @else {
                  <img src="/avatars/bear-default.jpg" alt="Bear avatar" />
                }
              </div>
              <div class="member-info">
                <span class="member-name">{{ member.fullName }}</span>
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
              </div>
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: [`
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
      h2 { margin: 0; }
    }
    .filters {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }
    .search-field { width: 220px; }
    .role-field { width: 160px; }
    .loading {
      display: flex;
      justify-content: center;
      padding: 48px;
    }
    .members-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 16px;
    }
    .member-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      padding: 20px 12px;
      border-radius: 12px;
      background: #fff;
      box-shadow: 0 1px 4px rgba(0,0,0,.08);
      text-align: center;
      text-decoration: none;
      color: inherit;
      transition: box-shadow 0.15s, transform 0.15s;
      cursor: pointer;
      &:hover {
        box-shadow: 0 4px 12px rgba(0,0,0,.15);
        transform: translateY(-2px);
      }
    }
    .avatar {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      overflow: hidden;
      background: #f0f0f0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }
    .avatar-banned { opacity: 0.5; filter: grayscale(1); }
    .avatar-fallback { font-size: 2rem; }
    .member-info {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .member-name { font-weight: 500; font-size: 0.9rem; }
    .member-city { font-size: 0.75rem; color: #888; }
    .invited-by { font-size: 0.7rem; color: #bbb; font-style: italic; }
    mat-chip {
      font-size: 0.7rem !important;
      min-height: 20px !important;
    }
    .role-admin { --mdc-chip-label-text-color: #fff; background: #1E4D8C !important; }
    .role-moderator { --mdc-chip-label-text-color: #fff; background: #C9933A !important; }
    .chip-banned { background: #ffccbc !important; }
  `],
})
export class MembersComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  readonly loading = signal(true);
  readonly members = signal<Member[]>([]);
  readonly query = signal('');
  readonly roleFilter = signal('');

  readonly showRoles = computed(() => {
    const role = this.authService.currentUser()?.role;
    return role === 'admin' || role === 'moderator';
  });

  readonly filtered = computed(() => {
    const q = this.query().toLowerCase();
    const r = this.roleFilter();
    return this.members().filter((m) => {
      if (q && !m.fullName.toLowerCase().includes(q)) return false;
      if (r && m.role !== r) return false;
      return true;
    });
  });

  ngOnInit(): void {
    this.http.get<Member[]>('/api/v1/users/members').subscribe({
      next: (members) => {
        this.members.set(members);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onSearch(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value.trim());
  }
}
