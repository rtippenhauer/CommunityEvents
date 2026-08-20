import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminTenant, TenantsAdminService } from '../../../core/services/tenants-admin.service';

export interface TenantDeleteDialogData {
  tenant: AdminTenant;
}

/**
 * The last of the three gates on deleting a community.
 *
 * The other two are enforced by the API and cannot be bypassed here: the
 * community must already be suspended, and it must not be the root. This dialog
 * adds the part only a person can supply -- retyping the domain. A button can
 * be clicked by accident; a domain cannot be typed without having read which
 * community it names.
 *
 * The counts are shown because "delete this community" is abstract and "delete
 * 47 members and 12 events" is not. They come from the list the operator was
 * already looking at, so no extra request is made to render a warning.
 */
@Component({
  selector: 'app-tenant-delete-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title class="danger-title">
      <mat-icon>warning</mat-icon> Delete {{ data.tenant.slug }}
    </h2>

    <mat-dialog-content>
      <p class="lead">
        This permanently deletes <strong>{{ data.tenant.domain }}</strong> and everything in it.
      </p>

      <ul class="counts">
        <li>{{ data.tenant.memberCount }} member{{ data.tenant.memberCount === 1 ? '' : 's' }}</li>
        <li>{{ data.tenant.eventCount }} event{{ data.tenant.eventCount === 1 ? '' : 's' }}</li>
        <li>
          {{ data.tenant.locationCount }} location{{ data.tenant.locationCount === 1 ? '' : 's' }}
        </li>
        <li>all ratings, points, invites and history</li>
      </ul>

      <p class="warn">This cannot be undone. There is no backup taken first.</p>

      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="confirm-field">
        <mat-label>Type {{ data.tenant.domain }} to confirm</mat-label>
        <input matInput [formControl]="confirmation" autocomplete="off" />
      </mat-form-field>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button
        mat-raised-button
        class="danger-btn"
        (click)="remove()"
        [disabled]="!matches() || deleting"
      >
        @if (deleting) {
          <mat-spinner diameter="20" />
        } @else {
          Delete permanently
        }
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .danger-title {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #b3261e;
      }
      mat-dialog-content {
        min-width: 380px;
      }
      .lead {
        margin: 0 0 12px;
      }
      .counts {
        margin: 0 0 12px;
        padding-left: 20px;
        font-size: 13px;
        line-height: 1.7;
        color: rgba(0, 0, 0, 0.7);
      }
      .warn {
        margin: 0 0 16px;
        font-size: 13px;
        font-weight: 600;
        color: #b3261e;
      }
      .confirm-field {
        width: 100%;
      }
      .danger-btn {
        background: #b3261e !important;
        color: #fff !important;
      }
      .danger-btn[disabled] {
        background: rgba(0, 0, 0, 0.12) !important;
        color: rgba(0, 0, 0, 0.38) !important;
      }
    `,
  ],
})
export class TenantDeleteDialogComponent {
  readonly data = inject<TenantDeleteDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<TenantDeleteDialogComponent>);
  private readonly tenantsAdminService = inject(TenantsAdminService);
  private readonly snackBar = inject(MatSnackBar);

  readonly confirmation = new FormControl('', { nonNullable: true });
  deleting = false;

  /**
   * Compared leniently -- trimmed, lower-cased and with a "www." allowed --
   * because the API normalises the same way. Being stricter here would reject
   * input the server would have accepted, which reads as a broken form.
   */
  matches(): boolean {
    const typed = this.confirmation.value.trim().toLowerCase().replace(/^www\./, '');
    return typed === this.data.tenant.domain.toLowerCase();
  }

  remove(): void {
    if (!this.matches()) return;
    this.deleting = true;

    this.tenantsAdminService.remove(this.data.tenant.id, this.confirmation.value.trim()).subscribe({
      next: () => {
        this.deleting = false;
        this.snackBar.open(`${this.data.tenant.domain} deleted`, 'OK', { duration: 5000 });
        this.dialogRef.close(true);
      },
      error: (err: HttpErrorResponse) => {
        this.deleting = false;
        const msg = err?.error?.message ?? 'Delete failed';
        this.snackBar.open(typeof msg === 'string' ? msg : JSON.stringify(msg), 'OK', {
          duration: 8000,
        });
      },
    });
  }
}
