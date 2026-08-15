import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AdminTenant, TenantsAdminService } from '../../../core/services/tenants-admin.service';

export interface TenantFormDialogData {
  tenant?: AdminTenant;
}

@Component({
  selector: 'app-tenant-form-dialog',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSlideToggleModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.tenant ? 'Edit' : 'Add' }} Community</h2>

    <mat-dialog-content>
      <form [formGroup]="form" class="tenant-form">
        <mat-form-field appearance="outline">
          <mat-label>Domain</mat-label>
          <input matInput formControlName="domain" placeholder="dayton.communityeventsproject.com" />
          <mat-hint>
            The host this community answers on. A "www." prefix is stripped — www and the bare
            domain are always the same community.
          </mat-hint>
          <mat-error>A full domain is required</mat-error>
        </mat-form-field>

        @if (isRoot) {
          <p class="root-note">
            This is the root community. Its domain is set by <code>ROOT_TENANT_URL</code> and
            applied at deploy, so it cannot be changed here — and it cannot be suspended, since
            that would take this page offline with it.
          </p>
        }

        <mat-form-field appearance="outline">
          <mat-label>Slug</mat-label>
          <input matInput formControlName="slug" />
          <mat-hint>
            Short handle. Defaults to the first part of the domain — lowercase letters, numbers and
            hyphens only.
          </mat-hint>
          <mat-error>Lowercase letters, numbers and hyphens only</mat-error>
        </mat-form-field>

        <mat-slide-toggle formControlName="active" [disabled]="isRoot">Active</mat-slide-toggle>
        @if (!form.getRawValue().active) {
          <p class="suspend-note">
            Suspended communities answer every request with a holding page. Members cannot sign in
            and no data is deleted.
          </p>
        }
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button mat-raised-button color="primary" (click)="save()" [disabled]="form.invalid || saving">
        @if (saving) {
          <mat-spinner diameter="20" />
        } @else {
          Save
        }
      </button>
    </mat-dialog-actions>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .tenant-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
        width: 100%;
        min-width: 360px;
        padding-top: 8px;
      }
      mat-form-field {
        width: 100%;
      }
      .root-note,
      .suspend-note {
        margin: 4px 0 0;
        font-size: 12px;
        line-height: 1.5;
        color: rgba(0, 0, 0, 0.6);
      }
      .root-note code {
        font-size: 11px;
      }
      .suspend-note {
        color: #b26a00;
      }
    `,
  ],
})
export class TenantFormDialogComponent {
  readonly data = inject<TenantFormDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<TenantFormDialogComponent>);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly tenantsAdminService = inject(TenantsAdminService);
  private readonly snackBar = inject(MatSnackBar);

  saving = false;

  readonly isRoot = this.data.tenant?.isRoot ?? false;

  readonly form = this.fb.group({
    domain: [
      { value: this.data.tenant?.domain ?? '', disabled: this.isRoot },
      [Validators.required, Validators.maxLength(255)],
    ],
    slug: [
      this.data.tenant?.slug ?? '',
      [Validators.maxLength(50), Validators.pattern(/^[a-z0-9-]*$/)],
    ],
    active: [{ value: (this.data.tenant?.status ?? 'active') === 'active', disabled: this.isRoot }],
  });

  save(): void {
    if (this.form.invalid) return;
    this.saving = true;

    // getRawValue includes disabled controls, so the root tenant's untouched
    // domain would be sent straight back and the API would reject the request
    // as an attempt to change it. Only send what this form can actually edit.
    const raw = this.form.getRawValue();
    const payload = {
      slug: raw.slug || undefined,
      ...(this.isRoot ? {} : { domain: raw.domain, status: raw.active ? ('active' as const) : ('suspended' as const) }),
    };

    const req$ = this.data.tenant
      ? this.tenantsAdminService.update(this.data.tenant.id, payload)
      : this.tenantsAdminService.create({ domain: raw.domain, ...payload });

    req$.subscribe({
      next: (tenant) => {
        this.saving = false;
        this.dialogRef.close(tenant);
      },
      error: (err: HttpErrorResponse) => {
        this.saving = false;
        const msg = err?.error?.message ?? 'Save failed';
        this.snackBar.open(typeof msg === 'string' ? msg : JSON.stringify(msg), 'OK', {
          duration: 6000,
        });
      },
    });
  }
}
