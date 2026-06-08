import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';

interface AdminUser {
  id: number;
  fullName: string;
  email: string;
  role: string;
  status: string;
  cityId: number;
  profilePhotoPath: string | null;
  invitedById: number | null;
  invitedByName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  loginCount: number;
}

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [
    DatePipe,
    MatCardModule,
    MatTableModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatInputModule,
    MatFormFieldModule,
  ],
  template: `
    <div class="admin-users-container">
      <mat-card>
        <mat-card-header>
          <mat-card-title>Members ({{ filtered().length }})</mat-card-title>
          <div class="header-actions">
            <mat-form-field appearance="outline" class="search-field">
              <mat-label>Search</mat-label>
              <input matInput (input)="onSearch($event)" placeholder="Name or email…" />
            </mat-form-field>
          </div>
        </mat-card-header>
        <mat-card-content>
          @if (loading()) {
            <div class="loading"><mat-spinner diameter="40" /></div>
          } @else {
            <div class="table-wrapper">
              <table mat-table [dataSource]="filtered()" class="users-table">

                <ng-container matColumnDef="photo">
                  <th mat-header-cell *matHeaderCellDef></th>
                  <td mat-cell *matCellDef="let u">
                    <div class="avatar">
                      @if (u.profilePhotoPath) {
                        <img [src]="u.profilePhotoPath" [alt]="u.fullName" />
                      } @else {
                        <img src="/avatars/bear-default.jpg" alt="Bear avatar" />
                      }
                    </div>
                  </td>
                </ng-container>

                <ng-container matColumnDef="name">
                  <th mat-header-cell *matHeaderCellDef>Name</th>
                  <td mat-cell *matCellDef="let u">
                    <div class="name-cell">
                      <span class="name">{{ u.fullName }}</span>
                      <span class="email">{{ u.email }}</span>
                    </div>
                  </td>
                </ng-container>

                <ng-container matColumnDef="role">
                  <th mat-header-cell *matHeaderCellDef>Role</th>
                  <td mat-cell *matCellDef="let u">
                    <mat-chip [class]="'role-' + u.role">{{ u.role }}</mat-chip>
                  </td>
                </ng-container>

                <ng-container matColumnDef="status">
                  <th mat-header-cell *matHeaderCellDef>Status</th>
                  <td mat-cell *matCellDef="let u">
                    <mat-chip [class]="'status-' + u.status">{{ u.status }}</mat-chip>
                  </td>
                </ng-container>

                <ng-container matColumnDef="invitedBy">
                  <th mat-header-cell *matHeaderCellDef>Invited by</th>
                  <td mat-cell *matCellDef="let u">
                    {{ u.invitedByName ?? '—' }}
                  </td>
                </ng-container>

                <ng-container matColumnDef="joined">
                  <th mat-header-cell *matHeaderCellDef>Joined</th>
                  <td mat-cell *matCellDef="let u">
                    {{ u.createdAt | date:'mediumDate' }}
                  </td>
                </ng-container>

                <ng-container matColumnDef="lastLogin">
                  <th mat-header-cell *matHeaderCellDef>Last login</th>
                  <td mat-cell *matCellDef="let u">
                    {{ u.lastLoginAt ? (u.lastLoginAt | date:'mediumDate') : '—' }}
                    @if (u.loginCount > 0) {
                      <span class="login-count">({{ u.loginCount }}x)</span>
                    }
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="columns"></tr>
                <tr mat-row *matRowDef="let row; columns: columns;"></tr>
              </table>
            </div>
          }
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .admin-users-container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 16px;
    }
    mat-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      padding-bottom: 8px;
    }
    .header-actions {
      margin-left: auto;
    }
    .search-field {
      width: 240px;
    }
    .loading {
      display: flex;
      justify-content: center;
      padding: 48px;
    }
    .table-wrapper {
      overflow-x: auto;
    }
    .users-table {
      width: 100%;
    }
    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f0f0f0;
      font-size: 1.2rem;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }
    .name-cell {
      display: flex;
      flex-direction: column;
      .name { font-weight: 500; }
      .email { font-size: 0.75rem; color: #888; }
    }
    .login-count {
      font-size: 0.75rem;
      color: #aaa;
      margin-left: 4px;
    }
    mat-chip {
      font-size: 0.75rem !important;
      min-height: 22px !important;
    }
    .role-admin { --mdc-chip-label-text-color: #fff; background: #1E4D8C !important; }
    .role-moderator { --mdc-chip-label-text-color: #fff; background: #C9933A !important; }
    .role-member { background: #e0e0e0 !important; }
    .status-active { background: #c8e6c9 !important; }
    .status-suspended { background: #ffccbc !important; }
  `],
})
export class AdminUsersComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly columns = ['photo', 'name', 'role', 'status', 'invitedBy', 'joined', 'lastLogin'];
  readonly loading = signal(true);
  readonly users = signal<AdminUser[]>([]);
  readonly filtered = signal<AdminUser[]>([]);

  ngOnInit(): void {
    this.http.get<AdminUser[]>('/api/v1/admin/users').subscribe({
      next: (users) => {
        this.users.set(users);
        this.filtered.set(users);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onSearch(event: Event): void {
    const q = (event.target as HTMLInputElement).value.toLowerCase().trim();
    this.filtered.set(
      q
        ? this.users().filter(
            (u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
          )
        : this.users(),
    );
  }
}
