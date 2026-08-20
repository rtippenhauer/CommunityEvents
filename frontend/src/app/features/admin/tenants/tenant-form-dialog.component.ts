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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminTenant, TenantsAdminService } from '../../../core/services/tenants-admin.service';
import { BrandConfigService } from '../../../core/services/brand-config.service';

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
        <mat-form-field appearance="outline" subscriptSizing="dynamic">
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

        <mat-form-field appearance="outline" subscriptSizing="dynamic">
          <mat-label>Slug</mat-label>
          <input matInput formControlName="slug" />
          <mat-hint>
            Short handle. Defaults to the first part of the domain — lowercase letters, numbers and
            hyphens only.
          </mat-hint>
          <mat-error>Lowercase letters, numbers and hyphens only</mat-error>
        </mat-form-field>

        <!-- Create only. Editing a community must not silently mint another
             admin, and changing an existing admin's password belongs on that
             community's own user screen. -->
        @if (!data.tenant) {
          <div class="admin-section">
            <h3>First administrator</h3>
            <p class="admin-note">
              A new community has no way in without one: registration needs an invite, and
              invites have to come from someone who is already a member.
            </p>

            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Admin name</mat-label>
              <input matInput formControlName="adminName" />
            </mat-form-field>

            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Admin email</mat-label>
              <input matInput formControlName="adminEmail" type="email" />
              <mat-error>A valid email address is required</mat-error>
            </mat-form-field>

            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Admin password</mat-label>
              <input matInput formControlName="adminPassword" type="password" />
              <mat-hint>At least 8 characters. They can change it once signed in.</mat-hint>
              <mat-error>At least 8 characters</mat-error>
            </mat-form-field>
          </div>
        }

        <!-- Editable on create AND on edit. Unlike the admin block above, this
             is one setting with two doors onto it: the system admin cannot
             reach a community's own Settings page, because that page lives on
             the community's host and needs an account there. -->
        <div class="admin-section">
          <h3>Mail domain</h3>
          <p class="admin-note">
            Where this community's mail comes from — the address on its invites, calendar
            entries and reminders. It is <strong>not</strong> assumed from the web address
            above: a subdomain usually has no mail records, so mail sent from it would
            bounce with nothing to show for it.
          </p>

          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Mail domain</mat-label>
            <input matInput formControlName="mailDomain" [placeholder]="deploymentMailDomain" />
            @if (suggestionApplies()) {
              <mat-hint>
                Suggested, because {{ form.getRawValue().domain }} sits under
                {{ deploymentMailDomain }} — the domain this deployment already sends from.
              </mat-hint>
            } @else {
              <mat-hint>
                Leave blank to use {{ deploymentMailDomain || 'the deployment default' }}. Set
                it only if this community receives mail on a domain of its own.
              </mat-hint>
            }
          </mat-form-field>
        </div>

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
      .admin-section {
        margin-top: 8px;
        padding-top: 12px;
        border-top: 1px solid rgba(0, 0, 0, 0.12);
        display: flex;
        flex-direction: column;
      }
      .admin-section h3 {
        margin: 0 0 4px;
        font-size: 14px;
      }
      .admin-note {
        margin: 0 0 12px;
        font-size: 12px;
        line-height: 1.5;
        color: rgba(0, 0, 0, 0.6);
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
  private readonly brandConfig = inject(BrandConfigService);

  saving = false;

  /**
   * The domain this deployment already sends mail from.
   *
   * Read from branding rather than assembled here: a system admin is by
   * definition browsing on the root tenant's host, so this is the root
   * tenant's own mail domain -- the one value on the page already known to
   * have working mail records behind it.
   *
   * A getter, not a field, so it tracks the signal: branding is fetched, and a
   * field would snapshot whatever was there when the dialog opened. Same shape
   * city-form-dialog.component.ts uses.
   */
  get deploymentMailDomain(): string {
    return this.brandConfig.baseDomain();
  }

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
    // Required together or not at all: a name without credentials creates
    // nothing, and credentials without a name are fine (the API defaults it).
    adminName: [''],
    adminEmail: ['', this.data.tenant ? [] : [Validators.required, Validators.email]],
    adminPassword: [
      '',
      this.data.tenant ? [] : [Validators.required, Validators.minLength(8)],
    ],
    // Optional: blank is a real answer meaning "inherit the deployment's",
    // which is why the existing value is read with ?? rather than ||.
    mailDomain: [this.data.tenant?.mailDomain ?? ''],
  });

  constructor() {
    // Suggest a mail domain as the operator types the web address. Only ever a
    // suggestion, and only in the one case where a suggestion is safe -- see
    // suggestFor().
    this.form.controls.domain.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((domain) => {
        // Never overwrite something the operator typed themselves. Once they
        // touch the field it is theirs, even if they then clear it.
        if (this.form.controls.mailDomain.dirty) return;
        // On edit the field already holds what the server has; suggesting over
        // it would silently rewrite a stored setting.
        if (this.data.tenant) return;
        this.form.controls.mailDomain.setValue(this.suggestFor(domain), { emitEvent: false });
      });
  }

  /**
   * What to prefill for a given community domain, or '' for "no suggestion".
   *
   * Only suggests when the new community sits under the deployment's own
   * domain, which is the common case -- dayton.communityeventsproject.com
   * inherits communityeventsproject.com, a domain whose mail already works.
   *
   * Deliberately silent for a community on its own apex. Guessing there would
   * mean asserting that daytonfood.org accepts mail, which this app cannot
   * know; blank still resolves to the deployment default at read time, and the
   * hint tells the operator to set it if that is wrong. A wrong guess here is
   * the expensive kind of wrong -- mail from a domain with no MX record
   * disappears without an error anywhere.
   */
  private suggestFor(domain: string): string {
    const deployment = this.deploymentMailDomain;
    return deployment && this.isSubdomainOf(domain, deployment) ? deployment : '';
  }

  private isSubdomainOf(host: string, parent: string): boolean {
    const h = host.trim().toLowerCase().replace(/^www\./, '');
    return !!parent && h.endsWith(`.${parent.toLowerCase()}`);
  }

  /** Whether the value currently shown is this dialog's suggestion. */
  suggestionApplies(): boolean {
    const raw = this.form.getRawValue();
    return !!raw.mailDomain && raw.mailDomain === this.suggestFor(raw.domain);
  }

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
      // Sent even when empty: clearing it is how a community goes back to
      // inheriting the deployment default, so '' has to reach the API.
      mailDomain: raw.mailDomain.trim(),
    };

    // The admin fields exist on create only, and are never sent on an update --
    // editing a community must not mint a second admin.
    const req$ = this.data.tenant
      ? this.tenantsAdminService.update(this.data.tenant.id, payload)
      : this.tenantsAdminService.create({
          domain: raw.domain,
          ...payload,
          adminName: raw.adminName || undefined,
          adminEmail: raw.adminEmail,
          adminPassword: raw.adminPassword,
        });

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
