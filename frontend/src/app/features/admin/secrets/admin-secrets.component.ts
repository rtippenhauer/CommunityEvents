import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';

/**
 * Where a key currently resolves from. Mirrors TenantSecretStatus on the API --
 * with deliberately no field for the value, because the API never sends one.
 */
interface SecretStatus {
  key: string;
  label: string;
  source: 'tenant' | 'deployment' | 'unset';
  deploymentEnvVar: string;
}

@Component({
  selector: 'app-admin-secrets',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatChipsModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="page">
      <h1>API Keys</h1>
      <p class="intro">
        Third-party keys this community uses. Each is encrypted before it is stored and is
        never sent back to this page -- you can replace a key or remove it, but not read it.
      </p>
      <p class="intro">
        Leave one unset to use the deployment's own key, which is what happens today unless
        you change something here.
      </p>

      @if (loading()) {
        <mat-spinner diameter="32" />
      } @else {
        @for (secret of secrets(); track secret.key) {
          <mat-card class="secret-card">
            <mat-card-header>
              <mat-card-title>{{ secret.label }}</mat-card-title>
              <mat-card-subtitle>
                @switch (secret.source) {
                  @case ('tenant') {
                    <mat-chip highlighted>This community's own key</mat-chip>
                  }
                  @case ('deployment') {
                    <mat-chip>Using the deployment default ({{ secret.deploymentEnvVar }})</mat-chip>
                  }
                  @case ('unset') {
                    <mat-chip>Not configured -- this feature is off</mat-chip>
                  }
                }
              </mat-card-subtitle>
            </mat-card-header>
            <mat-card-content>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>New key</mat-label>
                <input
                  matInput
                  type="password"
                  autocomplete="off"
                  [value]="drafts()[secret.key] ?? ''"
                  (input)="setDraft(secret.key, $event)"
                />
                <mat-hint>Paste a key to replace whatever is stored. Blank changes nothing.</mat-hint>
              </mat-form-field>
            </mat-card-content>
            <mat-card-actions>
              <button
                mat-raised-button
                color="primary"
                [disabled]="saving() || !drafts()[secret.key]"
                (click)="save(secret)"
              >
                Save
              </button>
              @if (secret.source === 'tenant') {
                <button mat-stroked-button [disabled]="saving()" (click)="clear(secret)">
                  Remove and use the deployment default
                </button>
              }
            </mat-card-actions>
          </mat-card>
        }
      }
    </div>
  `,
  styles: [
    `
      .page {
        max-width: 720px;
        margin: 0 auto;
        padding: 24px 16px 48px;
      }
      .intro {
        color: #555;
        margin-bottom: 8px;
      }
      .secret-card {
        margin-top: 20px;
      }
      .full-width {
        width: 100%;
      }
      mat-card-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        padding: 0 16px 16px;
      }
      mat-card-subtitle {
        margin-top: 6px;
      }
    `,
  ],
})
export class AdminSecretsComponent {
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);

  readonly secrets = signal<SecretStatus[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);

  /**
   * Typed-but-unsaved values, per key. Held outside a FormGroup because the set
   * of fields comes from the API rather than being known at build time, and a
   * dynamic FormGroup would have to be rebuilt on every reload.
   */
  readonly drafts = signal<Record<string, string>>({});

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.http.get<SecretStatus[]>('/api/v1/admin/secrets').subscribe({
      next: (rows) => {
        this.secrets.set(rows);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Could not load API keys', 'OK', { duration: 3000 });
      },
    });
  }

  setDraft(key: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.drafts.update((drafts) => ({ ...drafts, [key]: value }));
  }

  save(secret: SecretStatus): void {
    const value = this.drafts()[secret.key];
    if (!value) return;

    this.saving.set(true);
    this.http.put(`/api/v1/admin/secrets/${secret.key}`, { value }).subscribe({
      next: () => {
        // Cleared immediately: the value is stored now and this page has no way
        // to show it again, so leaving it in the box would imply otherwise.
        this.drafts.update((drafts) => ({ ...drafts, [secret.key]: '' }));
        this.saving.set(false);
        this.snackBar.open(`${secret.label} saved`, 'OK', { duration: 2000 });
        this.load();
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Failed to save', 'OK', { duration: 3000 });
      },
    });
  }

  clear(secret: SecretStatus): void {
    if (!confirm(`Remove this community's ${secret.label}?`)) return;

    this.saving.set(true);
    this.http.delete(`/api/v1/admin/secrets/${secret.key}`).subscribe({
      next: () => {
        this.saving.set(false);
        this.snackBar.open(`${secret.label} removed`, 'OK', { duration: 2000 });
        this.load();
      },
      error: () => {
        this.saving.set(false);
        this.snackBar.open('Failed to remove', 'OK', { duration: 3000 });
      },
    });
  }
}
