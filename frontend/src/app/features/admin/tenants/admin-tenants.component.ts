import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminTenant, TenantsAdminService } from '../../../core/services/tenants-admin.service';
import {
  TenantFormDialogComponent,
  TenantFormDialogData,
} from './tenant-form-dialog.component';
import { TenantDeleteDialogComponent } from './tenant-delete-dialog.component';
import { TenantUsersDialogComponent } from './tenant-users-dialog.component';

/**
 * The tenant registry, for the system admin (REQ-TENANT-01.7).
 *
 * Lives under /admin/ alongside the other admin screens for navigational
 * familiarity, but it is the only one gated by systemAdminGuard rather than
 * adminGuard — a community's admin cannot reach it, and the API refuses it a
 * second time regardless.
 *
 * Laid out as a list rather than a grid of cards. A community is one name, one
 * domain, three numbers and three actions -- a row holds that, where a
 * fixed-width card did not: the third action overflowed the card and, on every
 * community but the last, was hidden underneath the next one, which looked like
 * the delete button simply not existing. (Rob, 2026-08-18.)
 *
 * Delete is offered only on a community that is already suspended, and then
 * only behind a retyped domain. Suspending stays the ordinary way to take one
 * offline -- instant, reversible, and what the Active toggle does; deleting
 * removes every row that belongs to the community and cannot be undone.
 *
 * The People button is here rather than inside that community because a system
 * admin has no account there: its own admin screens live on its host behind a
 * session for it.
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
    MatTooltipModule,
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
        <!-- A list, not a grid of cards. The row is what a community actually
             is here: one name, one domain, three numbers and three actions.
             Cards forced all of that into a fixed-width column, and the third
             action pushed the delete button outside the card entirely -- on
             every community except the last, where it landed underneath the
             next card and looked like it was missing. -->
        <div class="tenant-list" role="list">
          @for (tenant of tenants(); track tenant.id) {
            <div
              class="tenant-row"
              role="listitem"
              [class.suspended]="tenant.status === 'suspended'"
            >
              <div class="identity">
                <div class="name-line">
                  <span class="slug">{{ tenant.slug }}</span>
                  @if (tenant.isRoot) {
                    <mat-chip class="chip-root">Root</mat-chip>
                  }
                  @if (tenant.status === 'suspended') {
                    <mat-chip class="chip-suspended">Suspended</mat-chip>
                  }
                </div>
                <a class="domain" [href]="'https://' + tenant.domain" target="_blank" rel="noopener">
                  {{ tenant.domain }}
                </a>
              </div>

              <div class="stats">
                <div class="stat">
                  <span class="stat-value">{{ tenant.memberCount }}</span>
                  <span class="stat-label">Members</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ tenant.eventCount }}</span>
                  <span class="stat-label">Events</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ tenant.locationCount }}</span>
                  <span class="stat-label">Locations</span>
                </div>
              </div>

              <div class="actions">
                <button
                  mat-icon-button
                  (click)="openEdit(tenant)"
                  [attr.aria-label]="'Edit ' + tenant.slug"
                  matTooltip="Edit"
                >
                  <mat-icon>edit</mat-icon>
                </button>
                <button
                  mat-icon-button
                  (click)="openUsers(tenant)"
                  [attr.aria-label]="'Manage people in ' + tenant.slug"
                  matTooltip="People"
                >
                  <mat-icon>group</mat-icon>
                </button>
                <!-- Suspended, non-root only: the API refuses to delete an
                     active community, so offering it here would only produce an
                     error. The slot is held open either way so the row's
                     controls do not shift position between communities. -->
                @if (!tenant.isRoot && tenant.status === 'suspended') {
                  <button
                    mat-icon-button
                    class="delete-btn"
                    (click)="openDelete(tenant)"
                    [attr.aria-label]="'Delete ' + tenant.slug"
                    matTooltip="Delete permanently"
                  >
                    <mat-icon>delete_forever</mat-icon>
                  </button>
                } @else {
                  <span
                    class="action-placeholder"
                    [matTooltip]="
                      tenant.isRoot
                        ? 'The root community cannot be deleted'
                        : 'Suspend this community before it can be deleted'
                    "
                  ></span>
                }
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
        line-height: 1.5;
        color: rgba(0, 0, 0, 0.6);
        max-width: 60ch;
      }
      .loading {
        display: flex;
        justify-content: center;
        padding: 40px;
      }

      .tenant-list {
        display: flex;
        flex-direction: column;
        border: 1px solid rgba(0, 0, 0, 0.1);
        border-radius: 10px;
        overflow: hidden;
        background: #fff;
      }
      .tenant-row {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
        border-bottom: 1px solid rgba(0, 0, 0, 0.07);
      }
      .tenant-row:last-child {
        border-bottom: none;
      }
      .tenant-row.suspended {
        background: rgba(178, 106, 0, 0.05);
        border-left: 3px solid #b26a00;
      }

      /* Takes the slack, so long domains shrink rather than pushing the
         actions out of the row -- which is exactly what went wrong with the
         card layout this replaced. */
      .identity {
        flex: 1 1 auto;
        min-width: 0;
      }
      .name-line {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .slug {
        font-weight: 600;
        font-size: 15px;
      }
      .domain {
        display: block;
        margin-top: 2px;
        font-size: 12.5px;
        color: rgba(0, 0, 0, 0.6);
        text-decoration: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .domain:hover {
        text-decoration: underline;
        color: var(--db-primary);
      }

      .stats {
        display: flex;
        gap: 20px;
        flex: 0 0 auto;
      }
      .stat {
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 58px;
      }
      .stat-value {
        font-size: 17px;
        font-weight: 600;
        line-height: 1.1;
      }
      .stat-label {
        font-size: 10px;
        letter-spacing: 0.4px;
        text-transform: uppercase;
        color: rgba(0, 0, 0, 0.5);
      }

      /* Never shrinks: the controls are the one part of the row that must stay
         where the eye expects them, and clipping them is how the previous
         layout hid the delete button. */
      .actions {
        display: flex;
        align-items: center;
        gap: 2px;
        flex: 0 0 auto;
      }
      .delete-btn {
        color: #b3261e;
      }
      /* Holds the delete slot open so Edit and People do not move between one
         community and the next, and carries the tooltip explaining why the
         action is unavailable here. */
      .action-placeholder {
        display: inline-block;
        width: 40px;
        height: 40px;
      }

      .chip-root,
      .chip-suspended {
        font-size: 11px !important;
        min-height: 22px !important;
        padding: 0 8px !important;
      }
      .chip-root {
        background: #e1e8f0 !important;
      }
      .chip-suspended {
        background: #ffe0b2 !important;
      }

      .single-note {
        margin: 16px 0 0;
        font-size: 12.5px;
        line-height: 1.6;
        color: rgba(0, 0, 0, 0.6);
      }

      @media (max-width: 700px) {
        .tenants-header {
          flex-direction: column;
        }
        /* Stacks rather than scrolls sideways: the actions stay reachable on a
           phone, which is where an operator is most likely to be suspending
           something in a hurry. */
        .tenant-row {
          flex-wrap: wrap;
        }
        .identity {
          flex: 1 1 100%;
        }
        .stats {
          gap: 14px;
        }
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

  openUsers(tenant: AdminTenant): void {
    // Reloads on close: adding or suspending someone changes the member count
    // shown on the card behind it.
    this.dialog
      .open(TenantUsersDialogComponent, { data: { tenant } })
      .afterClosed()
      .subscribe(() => this.load());
  }

  openDelete(tenant: AdminTenant): void {
    this.dialog
      .open(TenantDeleteDialogComponent, { data: { tenant } })
      .afterClosed()
      .subscribe((deleted?: boolean) => {
        if (deleted) this.load();
      });
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
