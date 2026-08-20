import { Component, inject, signal, ChangeDetectionStrategy, OnInit } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  AdminTenant,
  AdminTenantUser,
  TenantsAdminService,
} from '../../../core/services/tenants-admin.service';

export interface TenantUsersDialogData {
  tenant: AdminTenant;
}

/** Mirrors ASSIGNABLE_TENANT_ROLES on the API, which refuses anything else. */
const ASSIGNABLE_ROLES = [
  { value: 'non_validated', label: 'Not validated' },
  { value: 'member', label: 'Member' },
  { value: 'moderator', label: 'Moderator' },
  { value: 'admin', label: 'Admin' },
  { value: 'disabled', label: 'Disabled' },
];

/**
 * The people inside one community, managed from the root tenant.
 *
 * Exists because a system admin holds no account in the communities they
 * administer, and those communities' own admin screens live on their own hosts.
 * Before this, an admin who left or forgot their password made a community
 * permanently unreachable.
 *
 * Two things are deliberately read-only here, both enforced by the API as well:
 * the service account (the deployment's own row in each community) and any
 * system admin. Neither belongs to the community being administered.
 */
@Component({
  selector: 'app-tenant-users-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatIconModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.tenant.slug }} — People</h2>

    <mat-dialog-content>
      <p class="hint">
        Accounts on <strong>{{ data.tenant.domain }}</strong
        >. You are managing them from outside that community, so changes here take effect there
        immediately.
      </p>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="32" /></div>
      } @else {
        <div class="user-list">
          @for (u of users(); track u.id) {
            <div class="user-row" [class.readonly]="isReadOnly(u)">
              <div class="who">
                <div class="name">
                  {{ u.fullName }}
                  @if (u.isServiceAccount) {
                    <mat-chip class="chip-service">Service account</mat-chip>
                  }
                  @if (u.role === 'system_admin') {
                    <mat-chip class="chip-service">System admin</mat-chip>
                  }
                  @if (u.status === 'suspended') {
                    <mat-chip class="chip-suspended">Suspended</mat-chip>
                  }
                </div>
                <div class="email">{{ u.email }}</div>
              </div>

              @if (isReadOnly(u)) {
                <div class="readonly-note">
                  {{
                    u.isServiceAccount
                      ? 'Managed by the deployment'
                      : 'Not managed from a community screen'
                  }}
                </div>
              } @else {
                <div class="actions">
                  <mat-form-field appearance="outline" subscriptSizing="dynamic" class="role-field">
                    <mat-select
                      [value]="u.role"
                      (selectionChange)="setRole(u, $event.value)"
                      [disabled]="busyId() === u.id"
                    >
                      @for (r of roles; track r.value) {
                        <mat-option [value]="r.value">{{ r.label }}</mat-option>
                      }
                    </mat-select>
                  </mat-form-field>

                  <button
                    mat-stroked-button
                    (click)="toggleSuspended(u)"
                    [disabled]="busyId() === u.id"
                  >
                    {{ u.status === 'suspended' ? 'Restore' : 'Suspend' }}
                  </button>

                  <button
                    mat-stroked-button
                    (click)="startReset(u)"
                    [disabled]="busyId() === u.id"
                  >
                    Set password
                  </button>
                </div>

                @if (resettingId() === u.id) {
                  <form class="reset-row" [formGroup]="resetForm">
                    <mat-form-field appearance="outline" subscriptSizing="dynamic">
                      <mat-label>New password</mat-label>
                      <input matInput formControlName="password" type="password" />
                      <mat-hint>At least 8 characters. Hand it over yourself.</mat-hint>
                    </mat-form-field>
                    <button
                      mat-raised-button
                      color="primary"
                      (click)="confirmReset(u)"
                      [disabled]="resetForm.invalid || busyId() === u.id"
                    >
                      Save
                    </button>
                    <button mat-button (click)="resettingId.set(null)">Cancel</button>
                  </form>
                }
              }
            </div>
          }
        </div>

        <div class="add-section">
          <h3>Add someone</h3>
          <p class="hint">
            Created verified and active, since you are vouching for the address by typing it.
          </p>
          <form [formGroup]="addForm" class="add-form">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Name</mat-label>
              <input matInput formControlName="fullName" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Email</mat-label>
              <input matInput formControlName="email" type="email" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Password</mat-label>
              <input matInput formControlName="password" type="password" />
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="role-field">
              <mat-label>Role</mat-label>
              <mat-select formControlName="role">
                @for (r of roles; track r.value) {
                  <mat-option [value]="r.value">{{ r.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <button
              mat-raised-button
              color="primary"
              (click)="add()"
              [disabled]="addForm.invalid || adding()"
            >
              @if (adding()) {
                <mat-spinner diameter="20" />
              } @else {
                Add
              }
            </button>
          </form>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      mat-dialog-content {
        min-width: 560px;
        max-width: 720px;
      }
      .hint {
        margin: 0 0 12px;
        font-size: 12px;
        line-height: 1.5;
        color: rgba(0, 0, 0, 0.6);
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 24px;
      }
      .user-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 0;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
      }
      .user-row.readonly {
        opacity: 0.7;
      }
      .name {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 500;
      }
      .email {
        font-size: 12px;
        color: rgba(0, 0, 0, 0.6);
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .role-field {
        width: 150px;
      }
      .readonly-note {
        font-size: 12px;
        font-style: italic;
        color: rgba(0, 0, 0, 0.5);
      }
      .reset-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        width: 100%;
        padding: 8px 0 4px;
      }
      .reset-row mat-form-field {
        flex: 1;
      }
      .add-section {
        margin-top: 20px;
        padding-top: 14px;
        border-top: 2px solid rgba(0, 0, 0, 0.12);
      }
      .add-section h3 {
        margin: 0 0 4px;
        font-size: 14px;
      }
      .add-form {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: 8px;
      }
      .add-form mat-form-field {
        flex: 1 1 150px;
      }
      .chip-service {
        background: #e1e8f0 !important;
        font-size: 11px !important;
      }
      .chip-suspended {
        background: #ffe0b2 !important;
        font-size: 11px !important;
      }
    `,
  ],
})
export class TenantUsersDialogComponent implements OnInit {
  readonly data = inject<TenantUsersDialogData>(MAT_DIALOG_DATA);
  private readonly tenantsAdminService = inject(TenantsAdminService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly roles = ASSIGNABLE_ROLES;
  readonly users = signal<AdminTenantUser[]>([]);
  readonly loading = signal(true);
  readonly adding = signal(false);
  readonly busyId = signal<number | null>(null);
  readonly resettingId = signal<number | null>(null);

  readonly addForm = this.fb.group({
    fullName: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    role: ['member'],
  });

  readonly resetForm = this.fb.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  ngOnInit(): void {
    this.load();
  }

  /** The API refuses both of these, so the UI should not offer them either. */
  isReadOnly(u: AdminTenantUser): boolean {
    return u.isServiceAccount || u.role === 'system_admin';
  }

  private load(): void {
    this.loading.set(true);
    this.tenantsAdminService.getUsers(this.data.tenant.id).subscribe({
      next: (users) => {
        this.users.set(users);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Could not load this community’s people', 'OK', { duration: 5000 });
      },
    });
  }

  setRole(u: AdminTenantUser, role: string): void {
    if (role === u.role) return;
    this.busyId.set(u.id);
    this.tenantsAdminService.updateUser(this.data.tenant.id, u.id, { role }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.snackBar.open(`${u.fullName} is now ${role}`, 'OK', { duration: 3000 });
        this.load();
      },
      error: (err: HttpErrorResponse) => this.fail(err, 'Could not change that role'),
    });
  }

  toggleSuspended(u: AdminTenantUser): void {
    const status = u.status === 'suspended' ? 'active' : 'suspended';
    this.busyId.set(u.id);
    this.tenantsAdminService.updateUser(this.data.tenant.id, u.id, { status }).subscribe({
      next: () => {
        this.busyId.set(null);
        this.load();
      },
      error: (err: HttpErrorResponse) => this.fail(err, 'Could not change that account'),
    });
  }

  startReset(u: AdminTenantUser): void {
    this.resetForm.reset({ password: '' });
    this.resettingId.set(u.id);
  }

  confirmReset(u: AdminTenantUser): void {
    if (this.resetForm.invalid) return;
    this.busyId.set(u.id);
    this.tenantsAdminService
      .resetUserPassword(this.data.tenant.id, u.id, this.resetForm.getRawValue().password)
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.resettingId.set(null);
          // Said plainly: nothing is emailed, so an unspoken password is a
          // locked-out account.
          this.snackBar.open(
            `Password set for ${u.email}. Nothing was emailed — tell them yourself.`,
            'OK',
            { duration: 8000 },
          );
        },
        error: (err: HttpErrorResponse) => this.fail(err, 'Could not set that password'),
      });
  }

  add(): void {
    if (this.addForm.invalid) return;
    this.adding.set(true);
    const val = this.addForm.getRawValue();
    this.tenantsAdminService
      .createUser(this.data.tenant.id, {
        fullName: val.fullName.trim(),
        email: val.email.trim(),
        password: val.password,
        role: val.role,
      })
      .subscribe({
        next: () => {
          this.adding.set(false);
          this.addForm.reset({ fullName: '', email: '', password: '', role: 'member' });
          this.load();
        },
        error: (err: HttpErrorResponse) => {
          this.adding.set(false);
          this.fail(err, 'Could not add that account');
        },
      });
  }

  private fail(err: HttpErrorResponse, fallback: string): void {
    this.busyId.set(null);
    const msg = err?.error?.message ?? fallback;
    this.snackBar.open(typeof msg === 'string' ? msg : JSON.stringify(msg), 'OK', {
      duration: 6000,
    });
    // Reload so a rejected change does not leave the row showing a value the
    // server never accepted.
    this.load();
  }
}
