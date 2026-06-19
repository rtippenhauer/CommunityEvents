import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { DatePipe } from '@angular/common';
import { Clipboard } from '@angular/cdk/clipboard';

interface FacebookGroup {
  id: number;
  name: string;
}

interface Invite {
  id: number;
  token: string;
  type: string;
  boundToEmail: string | null;
  expiresAt: string;
  isRevoked: boolean;
  useCount: number;
  maxUses: number | null;
  redeemedAt: string | null;
  createdAt: string;
}

@Component({
  selector: 'app-admin-invites',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePipe,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatTableModule,
    MatChipsModule,
    MatIconModule,
    MatSnackBarModule,
    MatDividerModule,
  ],
  template: `
    <div class="admin-invites">
      <h2>Invite Management</h2>

      <!-- Create Invite Form -->
      <mat-card class="create-card">
        <mat-card-header>
          <mat-card-title>Generate Invite Link</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="create()" class="create-form">
            <mat-form-field appearance="outline">
              <mat-label>Type</mat-label>
              <mat-select formControlName="type">
                <mat-option value="member">Member (single-use, 48h, tied to email)</mat-option>
                <mat-option value="admin">Admin (multi-use, up to 30 days)</mat-option>
                <mat-option value="campaign_facebook">
                  Campaign / Facebook (multi-use, up to 30 days)
                </mat-option>
              </mat-select>
            </mat-form-field>

            @if (form.value.type === 'member') {
              <mat-form-field appearance="outline">
                <mat-label>Invitee Email</mat-label>
                <input matInput formControlName="boundToEmail" type="email" />
                <mat-hint>This link will only work for this email address</mat-hint>
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Invitee Name (optional)</mat-label>
                <input matInput formControlName="boundToName" />
              </mat-form-field>
            }

            @if (form.value.type === 'campaign_facebook') {
              <mat-form-field appearance="outline">
                <mat-label>Facebook Group</mat-label>
                <mat-select formControlName="facebookGroupId">
                  @for (group of fbGroups(); track group.id) {
                    <mat-option [value]="group.id">{{ group.name }}</mat-option>
                  }
                  @if (fbGroups().length === 0) {
                    <mat-option disabled>No groups configured</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            }

            @if (form.value.type !== 'member') {
              <div class="limits-row">
                <mat-form-field appearance="outline" class="limit-field">
                  <mat-label>Expiry (days)</mat-label>
                  <input matInput type="number" formControlName="expiryDays" min="1" max="365"
                    [disabled]="!!form.value.noExpiry" />
                  <mat-hint>{{ form.value.noExpiry ? 'No expiry (2099)' : '1–365, default 30' }}</mat-hint>
                </mat-form-field>
                <mat-form-field appearance="outline" class="limit-field">
                  <mat-label>Max uses</mat-label>
                  <input matInput type="number" formControlName="maxUses" min="2" />
                  <mat-hint>Leave blank for unlimited</mat-hint>
                </mat-form-field>
              </div>
              <mat-checkbox formControlName="noExpiry">No expiry</mat-checkbox>
            }

            <mat-card-actions>
              <button mat-raised-button color="primary" type="submit" [disabled]="form.invalid">
                <mat-icon>add_link</mat-icon>
                Generate Link
              </button>
            </mat-card-actions>
          </form>
        </mat-card-content>
      </mat-card>

      @if (newInviteUrl()) {
        <mat-card class="new-link-card">
          <mat-card-content class="new-link-content">
            <mat-icon color="primary">check_circle</mat-icon>
            <span class="new-link-url">{{ newInviteUrl() }}</span>
            <button mat-icon-button (click)="copyLink()" aria-label="Copy link">
              <mat-icon>content_copy</mat-icon>
            </button>
          </mat-card-content>
        </mat-card>
      }

      <mat-divider />

      <!-- Invites Table -->
      <mat-card class="table-card">
        <mat-card-header>
          <mat-card-title>All Invites</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <table mat-table [dataSource]="invites()" class="invites-table">
            <ng-container matColumnDef="type">
              <th mat-header-cell *matHeaderCellDef>Type</th>
              <td mat-cell *matCellDef="let row">
                <mat-chip>{{ row.type }}</mat-chip>
              </td>
            </ng-container>

            <ng-container matColumnDef="boundToEmail">
              <th mat-header-cell *matHeaderCellDef>Bound To</th>
              <td mat-cell *matCellDef="let row">{{ row.boundToEmail ?? '—' }}</td>
            </ng-container>

            <ng-container matColumnDef="uses">
              <th mat-header-cell *matHeaderCellDef>Uses</th>
              <td mat-cell *matCellDef="let row">{{ row.useCount }} / {{ row.maxUses ?? '∞' }}</td>
            </ng-container>

            <ng-container matColumnDef="expires">
              <th mat-header-cell *matHeaderCellDef>Expires</th>
              <td mat-cell *matCellDef="let row">{{ row.expiresAt | date: 'shortDate' }}</td>
            </ng-container>

            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>Status</th>
              <td mat-cell *matCellDef="let row">
                @if (row.isRevoked) {
                  <mat-chip color="warn">Revoked</mat-chip>
                } @else if (row.redeemedAt && row.maxUses === 1) {
                  <mat-chip color="accent">Used</mat-chip>
                } @else if (isExpired(row)) {
                  <mat-chip>Expired</mat-chip>
                } @else {
                  <mat-chip color="primary">Active</mat-chip>
                }
              </td>
            </ng-container>

            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef></th>
              <td mat-cell *matCellDef="let row">
                <button
                  mat-icon-button
                  (click)="copyToken(row.token)"
                  aria-label="Copy invite link"
                  title="Copy link"
                >
                  <mat-icon>content_copy</mat-icon>
                </button>
                @if (!row.isRevoked && !isExpired(row)) {
                  <button
                    mat-icon-button
                    color="warn"
                    (click)="revoke(row.id)"
                    aria-label="Revoke invite"
                    title="Revoke"
                  >
                    <mat-icon>block</mat-icon>
                  </button>
                }
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .admin-invites {
        max-width: 960px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 24px;
      }
      .create-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding-top: 8px;
      }
      .limits-row {
        display: flex;
        gap: 12px;
        .limit-field { flex: 1; }
      }
      .new-link-card {
        background: #e8f5e9;
      }
      .new-link-content {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .new-link-url {
        font-family: monospace;
        font-size: 0.85rem;
        word-break: break-all;
        flex: 1;
      }
      .invites-table {
        width: 100%;
      }
    `,
  ],
})
export class AdminInvitesComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly clipboard = inject(Clipboard);

  readonly invites = signal<Invite[]>([]);
  readonly fbGroups = signal<FacebookGroup[]>([]);
  readonly newInviteUrl = signal<string | null>(null);
  readonly columns = ['type', 'boundToEmail', 'uses', 'expires', 'status', 'actions'];

  readonly form = this.fb.group({
    type: ['member' as 'member' | 'admin' | 'campaign_facebook', Validators.required],
    boundToEmail: [''],
    boundToName: [''],
    facebookGroupId: [null as number | null],
    expiryDays: [null as number | null],
    maxUses: [null as number | null],
    noExpiry: [false],
  });

  ngOnInit(): void {
    this.loadInvites();
    this.http.get<FacebookGroup[]>('/api/v1/facebook-groups').subscribe({
      next: (groups) => this.fbGroups.set(groups),
    });
  }

  loadInvites(): void {
    this.http.get<Invite[]>('/api/v1/invites').subscribe((invites) => this.invites.set(invites));
  }

  create(): void {
    const { type, boundToEmail, boundToName, facebookGroupId, expiryDays, maxUses, noExpiry } = this.form.getRawValue();
    const body: Record<string, unknown> = { type };
    if (type === 'member') {
      body['boundToEmail'] = boundToEmail;
      if (boundToName) body['boundToName'] = boundToName;
    }
    if (type === 'campaign_facebook' && facebookGroupId) {
      body['facebookGroupId'] = facebookGroupId;
    }
    if (type !== 'member') {
      if (noExpiry) body['noExpiry'] = true;
      else if (expiryDays) body['expiryDays'] = expiryDays;
      if (maxUses) body['maxUses'] = maxUses;
    }

    this.http.post<Invite>('/api/v1/invites', body).subscribe({
      next: (invite) => {
        const base = window.location.origin;
        this.newInviteUrl.set(`${base}/login?token=${invite.token}`);
        this.loadInvites();
        this.form.reset({ type: 'member' });
      },
      error: (err) => {
        const msg = err?.error?.message ?? 'Failed to create invite';
        this.snackBar.open(msg, 'OK', { duration: 4000 });
      },
    });
  }

  revoke(id: number): void {
    this.http.patch(`/api/v1/invites/${id}/revoke`, {}).subscribe({
      next: () => {
        this.snackBar.open('Invite revoked', 'OK', { duration: 3000 });
        this.loadInvites();
        this.newInviteUrl.set(null);
      },
    });
  }

  copyLink(): void {
    const url = this.newInviteUrl();
    if (url) {
      this.clipboard.copy(url);
      this.snackBar.open('Link copied', 'OK', { duration: 2000 });
    }
  }

  copyToken(token: string): void {
    const url = `${window.location.origin}/login?token=${token}`;
    this.clipboard.copy(url);
    this.snackBar.open('Link copied', 'OK', { duration: 2000 });
  }

  isExpired(invite: Invite): boolean {
    return new Date(invite.expiresAt) < new Date();
  }
}
