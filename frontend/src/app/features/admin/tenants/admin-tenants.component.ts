import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminTenant, TenantsAdminService } from '../../../core/services/tenants-admin.service';
import {
  TenantFormDialogComponent,
  TenantFormDialogData,
} from './tenant-form-dialog.component';

/**
 * The tenant registry, for the system admin (REQ-TENANT-01.7).
 *
 * Lives under /admin/ alongside the other admin screens for navigational
 * familiarity, but it is the only one gated by systemAdminGuard rather than
 * adminGuard — a community's admin cannot reach it, and the API refuses it a
 * second time regardless.
 *
 * There is no delete control because the API has no delete route: removing a
 * community would mean removing every row that belongs to it. Suspending is the
 * reversible equivalent and is what the Active toggle does.
 */
@Component({
  selector: 'app-admin-tenants',
  standalone: true,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="tenants-container">
      <div class="tenants-header">
        <div>
          <h2>Communities</h2>
          <p class="subtitle">
            Every community on this deployment. Each one is a domain — point DNS and the reverse
            proxy here, or it will never be reached.
          </p>
        </div>
        <button mat-raised-button color="primary" (click)="openCreate()">
          <mat-icon>add</mat-icon> Add Community
        </button>
      </div>

      @if (loading()) {
        <div class="loading"><mat-spinner diameter="36" /></div>
      } @else {
        <div class="tenants-grid">
          @for (tenant of tenants(); track tenant.id) {
            <div class="tenant-card" [class.suspended]="tenant.status === 'suspended'">
              <div class="tenant-header">
                <h3>{{ tenant.slug }}</h3>
                @if (tenant.isRoot) {
                  <mat-chip class="chip-root">Root</mat-chip>
                }
                @if (tenant.status === 'suspended') {
                  <mat-chip class="chip-suspended">Suspended</mat-chip>
                }
                <button
                  mat-icon-button
                  class="edit-btn"
                  (click)="openEdit(tenant)"
                  [attr.aria-label]="'Edit ' + tenant.slug"
                >
                  <mat-icon>edit</mat-icon>
                </button>
              </div>

              <div class="tenant-domain">{{ tenant.domain }}</div>

              <div class="tenant-stats">
                <div class="stat">
                  <span class="stat-value">{{ tenant.eventCount }}</span>
                  <span class="stat-label">Events</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ tenant.locationCount }}</span>
                  <span class="stat-label">Locations</span>
                </div>
              </div>
            </div>
          }
        </div>

        @if (tenants().length === 1) {
          <p class="single-note">
            This deployment serves one community. Adding another is a database row, not another
            deployment — but its domain still needs DNS and a reverse-proxy entry pointing here.
          </p>
        }
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .tenants-container {
        max-width: 900px;
        margin: 0 auto;
        padding: 16px;
      }
      .tenants-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
      }
      h2 {
        margin: 0;
      }
      .subtitle {
        margin: 4px 0 0;
        font-size: 13px;
        max-width: 52ch;
        color: rgba(0, 0, 0, 0.6);
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 48px;
      }
      .tenants-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 16px;
      }
      .tenant-card {
        background: #fff;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.1);
        position: relative;
      }
      .tenant-card.suspended {
        opacity: 0.72;
        border-left: 4px solid #b26a00;
      }
      .tenant-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 4px;
      }
      .tenant-header h3 {
        margin: 0;
        font-size: 18px;
      }
      .edit-btn {
        margin-left: auto;
      }
      .chip-root {
        --mdc-chip-label-text-size: 11px;
        background: #e8f0fe;
      }
      .chip-suspended {
        --mdc-chip-label-text-size: 11px;
        background: #fff0d6;
      }
      .tenant-domain {
        font-size: 13px;
        color: rgba(0, 0, 0, 0.6);
        word-break: break-all;
      }
      .tenant-stats {
        display: flex;
        gap: 24px;
        margin-top: 16px;
      }
      .stat {
        display: flex;
        flex-direction: column;
      }
      .stat-value {
        font-size: 20px;
        font-weight: 600;
      }
      .stat-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: rgba(0, 0, 0, 0.6);
      }
      .single-note {
        margin-top: 24px;
        font-size: 13px;
        max-width: 60ch;
        color: rgba(0, 0, 0, 0.6);
      }
    `,
  ],
})
export class AdminTenantsComponent implements OnInit {
  private readonly tenantsAdminService = inject(TenantsAdminService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly tenants = signal<AdminTenant[]>([]);
  readonly loading = signal(true);

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.tenantsAdminService.getAll().subscribe({
      next: (tenants) => {
        this.tenants.set(tenants);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Could not load communities', 'OK', { duration: 5000 });
      },
    });
  }

  openCreate(): void {
    this.openDialog({});
  }

  openEdit(tenant: AdminTenant): void {
    this.openDialog({ tenant });
  }

  private openDialog(data: TenantFormDialogData): void {
    this.dialog
      .open(TenantFormDialogComponent, { data })
      .afterClosed()
      .subscribe((saved?: AdminTenant) => {
        // Reload rather than patching the row in place: the counts come from the
        // server and a slug change reorders the list.
        if (saved) this.load();
      });
  }
}
