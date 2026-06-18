import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

interface OAuthProvider {
  provider: 'facebook' | 'google';
  providerId: string;
  email: string | null;
}

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
  oauthProviders: OAuthProvider[];
}

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [
    DatePipe,
    RouterLink,
    MatCardModule,
    MatTableModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatInputModule,
    MatFormFieldModule,
    MatButtonModule,
    MatSnackBarModule,
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
                  <td mat-cell *matCellDef="let u" (click)="$event.stopPropagation()">
                    <div class="name-cell">
                      <a class="name-link" [routerLink]="['/members', u.id]">{{ u.fullName }}</a>
                      <span class="email">{{ u.email }}</span>
                      @if (u.oauthProviders?.length) {
                        <div class="provider-badges">
                          @for (p of u.oauthProviders; track p.provider) {
                            @if (p.provider === 'facebook') {
                              <a class="provider-badge badge-fb"
                                 [href]="'https://www.facebook.com/profile.php?id=' + p.providerId"
                                 target="_blank" rel="noopener noreferrer"
                                 matTooltip="View Facebook profile"
                                 (click)="$event.stopPropagation()">fb</a>
                            } @else if (p.provider === 'google') {
                              <span class="provider-badge badge-g"
                                    [matTooltip]="p.email ? 'Google: ' + p.email : 'Google account linked'">G</span>
                            }
                          }
                        </div>
                      }
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
                    <mat-chip [class]="'status-' + u.status">{{ statusLabel(u.status) }}</mat-chip>
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

                <ng-container matColumnDef="actions">
                  <th mat-header-cell *matHeaderCellDef></th>
                  <td mat-cell *matCellDef="let u" (click)="$event.stopPropagation()">
                    <div class="actions-row">
                      <!-- Vouch (non_validated only) -->
                      @if (u.role === 'non_validated') {
                        @if (confirmVouchId() === u.id) {
                          <div class="confirm-row">
                            <span class="confirm-vouch-label">Vouch?</span>
                            <button mat-icon-button class="confirm-vouch-yes" (click)="confirmVouch(u.id)"
                              matTooltip="Yes, vouch this member" [disabled]="vouchingId() === u.id">
                              <mat-icon>check</mat-icon>
                            </button>
                            <button mat-icon-button (click)="cancelVouch()" matTooltip="Cancel">
                              <mat-icon>close</mat-icon>
                            </button>
                          </div>
                        } @else {
                          <button mat-icon-button class="vouch-btn" (click)="requestVouch(u.id)"
                            matTooltip="Vouch — upgrade to full member">
                            <mat-icon>how_to_reg</mat-icon>
                          </button>
                        }
                      }

                      <!-- Delete -->
                      @if (u.role !== 'admin') {
                        @if (confirmDeleteId() === u.id) {
                          <div class="confirm-row">
                            <span class="confirm-label">Delete?</span>
                            <button mat-icon-button class="confirm-yes" (click)="confirmDelete(u.id)"
                              matTooltip="Yes, dev delete" [disabled]="deletingId() === u.id">
                              <mat-icon>check</mat-icon>
                            </button>
                            <button mat-icon-button (click)="cancelDelete()" matTooltip="Cancel">
                              <mat-icon>close</mat-icon>
                            </button>
                          </div>
                        } @else {
                          <button mat-icon-button class="dev-delete-btn" (click)="requestDelete(u.id)"
                            matTooltip="Dev Delete — anonymizes email, removes OAuth, frees account for re-invite">
                            <mat-icon>delete_forever</mat-icon>
                          </button>
                        }
                      }
                    </div>
                  </td>
                </ng-container>

                <tr mat-header-row *matHeaderRowDef="columns"></tr>
                <tr mat-row *matRowDef="let row; columns: columns;" class="user-row" (click)="viewProfile(row.id)"></tr>
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
    .header-actions { margin-left: auto; }
    .search-field { width: 240px; }
    .loading { display: flex; justify-content: center; padding: 48px; }
    .table-wrapper { overflow-x: auto; }
    .users-table { width: 100%; }
    .user-row {
      cursor: pointer;
      &:hover { background: #fafafa; }
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
      img { width: 100%; height: 100%; object-fit: cover; }
    }
    .name-cell {
      display: flex;
      flex-direction: column;
    }
    .name-link {
      font-weight: 500;
      color: var(--db-brown-dark);
      text-decoration: none;
      &:hover { color: var(--db-amber); text-decoration: underline; }
    }
    .email { font-size: 0.75rem; color: #888; }
    .provider-badges { display: flex; gap: 4px; margin-top: 2px; }
    .provider-badge { font-size: 0.62rem; font-weight: 700; padding: 1px 5px; border-radius: 3px; line-height: 1.6; cursor: default; text-decoration: none; user-select: none; }
    .badge-fb { background: #1877f2; color: #fff; cursor: pointer; &:hover { background: #0f5cbf; } }
    .badge-g { background: #ea4335; color: #fff; }
    .login-count { font-size: 0.75rem; color: #aaa; margin-left: 4px; }
    mat-chip {
      font-size: 0.75rem !important;
      min-height: 22px !important;
    }
    .role-admin { --mdc-chip-label-text-color: #fff; background: #1E4D8C !important; }
    .role-moderator { --mdc-chip-label-text-color: #fff; background: #C9933A !important; }
    .role-member { background: #e0e0e0 !important; }
    .status-active { background: #c8e6c9 !important; }
    .status-suspended { background: #ffccbc !important; }
    .role-non_validated { background: #fff9c4 !important; --mdc-chip-label-text-color: #7a6200 !important; }
    .actions-row {
      display: flex;
      align-items: center;
      gap: 2px;
    }
    .dev-delete-btn { color: #c62828; opacity: 0.5; }
    .dev-delete-btn:hover { opacity: 1; }
    .vouch-btn { color: #2e7d32; opacity: 0.7; }
    .vouch-btn:hover { opacity: 1; }
    .confirm-row { display: flex; align-items: center; gap: 2px; }
    .confirm-label { font-size: 0.75rem; color: #c62828; font-weight: 500; }
    .confirm-yes { color: #c62828; }
    .confirm-vouch-label { font-size: 0.75rem; color: #2e7d32; font-weight: 500; }
    .confirm-vouch-yes { color: #2e7d32; }
  `],
})
export class AdminUsersComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly columns = ['photo', 'name', 'role', 'status', 'invitedBy', 'joined', 'lastLogin', 'actions'];
  readonly loading = signal(true);
  readonly users = signal<AdminUser[]>([]);
  readonly filtered = signal<AdminUser[]>([]);
  readonly confirmDeleteId = signal<number | null>(null);
  readonly deletingId = signal<number | null>(null);
  readonly confirmVouchId = signal<number | null>(null);
  readonly vouchingId = signal<number | null>(null);

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

  viewProfile(id: number): void {
    void this.router.navigate(['/members', id]);
  }

  statusLabel(status: string): string {
    return status;
  }

  // ── Vouch ────────────────────────────────────────────────────────────────────

  requestVouch(id: number): void {
    this.confirmDeleteId.set(null);
    this.confirmVouchId.set(id);
  }

  cancelVouch(): void {
    this.confirmVouchId.set(null);
  }

  confirmVouch(id: number): void {
    this.vouchingId.set(id);
    this.http.patch(`/api/v1/users/${id}/validate`, {}).subscribe({
      next: () => {
        this.vouchingId.set(null);
        this.confirmVouchId.set(null);
        const update = (u: AdminUser) => u.id === id ? { ...u, role: 'member' } : u;
        this.users.update((us) => us.map(update));
        this.filtered.update((us) => us.map(update));
        this.snackBar.open('Member vouched — role upgraded to member', 'OK', { duration: 4000 });
      },
      error: (err) => {
        this.vouchingId.set(null);
        this.confirmVouchId.set(null);
        this.snackBar.open(err?.error?.message ?? 'Vouch failed', 'OK', { duration: 4000 });
      },
    });
  }

  // ── Delete ────────────────────────────────────────────────────────────────────

  requestDelete(id: number): void {
    this.confirmVouchId.set(null);
    this.confirmDeleteId.set(id);
  }

  cancelDelete(): void {
    this.confirmDeleteId.set(null);
  }

  confirmDelete(id: number): void {
    this.deletingId.set(id);
    this.http.delete(`/api/v1/admin/users/${id}`).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.confirmDeleteId.set(null);
        const updated = this.users().filter((u) => u.id !== id);
        this.users.set(updated);
        this.filtered.set(this.filtered().filter((u) => u.id !== id));
        this.snackBar.open('User dev-deleted — email freed for re-invite', 'OK', { duration: 4000 });
      },
      error: (err) => {
        this.deletingId.set(null);
        this.confirmDeleteId.set(null);
        const msg = err?.error?.message ?? 'Delete failed';
        this.snackBar.open(msg, 'OK', { duration: 4000 });
      },
    });
  }
}
