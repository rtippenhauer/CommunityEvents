import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BrandConfigService } from '../../../core/services/brand-config.service';
import {
  OAuthConfig,
  OAuthConfigService,
  OAuthProviderUpdate,
} from '../../../core/services/oauth-config.service';
import { ConfirmDialogComponent } from '../../../shared/components/confirm-dialog/confirm-dialog.component';

type Provider = 'google' | 'facebook';

/**
 * Where a community registers its own Google and Meta apps (REQ-TENANT-01.9).
 *
 * The screen exists because there is no deployment-wide app to inherit: a
 * community either brings its own credentials or offers email/password only.
 * Nothing here is required to run a community, which is why the empty state is
 * written as a normal choice rather than as a warning.
 */
@Component({
  selector: 'app-admin-oauth',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="oauth-admin-page">
      <div class="page-header">
        <h1>Sign-in Providers</h1>
        <p class="subtitle">
          Let members of {{ brandConfig.brand().name }} sign in with Google or Facebook, using
          apps you register yourself. Email and password always works and needs nothing set up
          here — if you register neither app, that is simply the only way in, which is a
          perfectly ordinary way to run a community.
        </p>
        <p class="subtitle">
          Your own apps mean your community's name on the consent screen, and your relationship
          with the provider rather than ours.
        </p>
      </div>

      @if (loading()) {
        <div class="loading-row"><mat-spinner diameter="32" /></div>
      } @else {
        <mat-card class="provider-card">
          <mat-card-header>
            <mat-card-title>Google</mat-card-title>
            <mat-card-subtitle>
              @if (config()?.google?.enabled) {
                <span class="status on"><mat-icon>check_circle</mat-icon> Offered to members</span>
              } @else {
                <span class="status off"><mat-icon>remove_circle_outline</mat-icon> Not offered</span>
              }
            </mat-card-subtitle>
          </mat-card-header>

          <mat-card-content>
            <p class="redirect-hint">
              In the Google Cloud console, add this exact URL as an authorised redirect URI. It
              is the same for every community on this deployment, and it is not this
              community's own address — that is deliberate, and pasting this one is the step
              people most often get wrong.
            </p>
            <div class="redirect-uri">
              <code>{{ config()?.googleRedirectUri }}</code>
              <button mat-icon-button type="button" (click)="copyRedirect()" aria-label="Copy redirect URI">
                <mat-icon>content_copy</mat-icon>
              </button>
            </div>

            <form [formGroup]="googleForm" class="provider-form">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Client ID</mat-label>
                <input matInput formControlName="clientId" autocomplete="off" />
              </mat-form-field>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Client secret</mat-label>
                <input matInput formControlName="clientSecret" type="password" autocomplete="off" />
                <mat-hint>
                  @if (config()?.google?.secretSet) {
                    A secret is saved, encrypted, and cannot be shown again — so saving any
                    change means entering it once more, alongside the client ID it belongs to.
                  } @else {
                    Stored encrypted, and never shown again once saved.
                  }
                </mat-hint>
              </mat-form-field>
            </form>
          </mat-card-content>

          <mat-card-actions>
            <button
              mat-raised-button
              color="primary"
              [disabled]="saving() === 'google' || !googleForm.value.clientId"
              (click)="save('google')"
            >
              @if (saving() === 'google') { <mat-spinner diameter="20" /> } @else { Save }
            </button>
            @if (config()?.google?.enabled) {
              <button mat-button color="warn" [disabled]="!!saving()" (click)="switchOff('google')">
                Switch off
              </button>
            }
          </mat-card-actions>
        </mat-card>

        <mat-card class="provider-card">
          <mat-card-header>
            <mat-card-title>Facebook</mat-card-title>
            <mat-card-subtitle>
              @if (config()?.facebook?.enabled) {
                <span class="status on"><mat-icon>check_circle</mat-icon> Offered to members</span>
              } @else {
                <span class="status off"><mat-icon>remove_circle_outline</mat-icon> Not offered</span>
              }
            </mat-card-subtitle>
          </mat-card-header>

          <mat-card-content>
            <p class="redirect-hint">
              Facebook sign-in happens in the browser rather than through a redirect, so there
              is no URL to register. Add this community's own address to your app's allowed
              domains instead.
            </p>

            <form [formGroup]="facebookForm" class="provider-form">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>App ID</mat-label>
                <input matInput formControlName="clientId" autocomplete="off" />
              </mat-form-field>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>App secret</mat-label>
                <input matInput formControlName="clientSecret" type="password" autocomplete="off" />
                <mat-hint>
                  @if (config()?.facebook?.secretSet) {
                    A secret is saved, encrypted, and cannot be shown again — so saving any
                    change means entering it once more, alongside the App ID it belongs to.
                  } @else {
                    Stored encrypted, and never shown again once saved.
                  }
                </mat-hint>
              </mat-form-field>
            </form>
          </mat-card-content>

          <mat-card-actions>
            <button
              mat-raised-button
              color="primary"
              [disabled]="saving() === 'facebook' || !facebookForm.value.clientId"
              (click)="save('facebook')"
            >
              @if (saving() === 'facebook') { <mat-spinner diameter="20" /> } @else { Save }
            </button>
            @if (config()?.facebook?.enabled) {
              <button mat-button color="warn" [disabled]="!!saving()" (click)="switchOff('facebook')">
                Switch off
              </button>
            }
          </mat-card-actions>
        </mat-card>
      }
    </div>
  `,
  styles: [
    `
      .oauth-admin-page {
        max-width: 760px;
        margin: 0 auto;
        padding: 24px 16px 48px;
      }
      .page-header h1 {
        margin: 0 0 8px;
      }
      .subtitle {
        color: rgba(0, 0, 0, 0.6);
        margin: 0 0 8px;
        line-height: 1.5;
      }
      .loading-row {
        display: flex;
        justify-content: center;
        padding: 48px 0;
      }
      .provider-card {
        margin-top: 24px;
      }
      .status {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .status mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
      .status.on {
        color: #2e7d32;
      }
      .status.off {
        color: rgba(0, 0, 0, 0.5);
      }
      .redirect-hint {
        color: rgba(0, 0, 0, 0.6);
        line-height: 1.5;
      }
      .redirect-uri {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(0, 0, 0, 0.04);
        border-radius: 4px;
        padding: 8px 12px;
        margin-bottom: 16px;
        overflow-x: auto;
      }
      .redirect-uri code {
        white-space: nowrap;
      }
      .provider-form {
        display: flex;
        flex-direction: column;
      }
      .full-width {
        width: 100%;
      }
    `,
  ],
})
export class AdminOAuthComponent implements OnInit {
  private readonly oauthConfig = inject(OAuthConfigService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  readonly brandConfig = inject(BrandConfigService);

  readonly loading = signal(true);
  readonly saving = signal<Provider | null>(null);
  readonly config = signal<OAuthConfig | null>(null);

  readonly googleForm = this.fb.group({
    clientId: ['', Validators.maxLength(255)],
    clientSecret: ['', Validators.maxLength(512)],
  });

  readonly facebookForm = this.fb.group({
    clientId: ['', Validators.maxLength(255)],
    clientSecret: ['', Validators.maxLength(512)],
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.oauthConfig.get().subscribe({
      next: (config) => {
        this.apply(config);
        this.loading.set(false);
      },
      error: () => {
        this.snackBar.open('Could not load sign-in providers.', 'Dismiss', { duration: 5000 });
        this.loading.set(false);
      },
    });
  }

  private apply(config: OAuthConfig): void {
    this.config.set(config);
    // Ids are echoed back; secrets never are, so those fields always start
    // empty and an empty one on save means "keep what is stored".
    this.googleForm.patchValue({ clientId: config.google.clientId ?? '', clientSecret: '' });
    this.facebookForm.patchValue({ clientId: config.facebook.clientId ?? '', clientSecret: '' });
  }

  private formFor(provider: Provider) {
    return provider === 'google' ? this.googleForm : this.facebookForm;
  }

  save(provider: Provider): void {
    const form = this.formFor(provider);
    const clientId = form.value.clientId?.trim();
    const clientSecret = form.value.clientSecret?.trim();
    if (!clientId) return;

    // Both halves, always — the API requires it and this says so before a
    // round trip. There is no "leave it blank to keep the stored one": the
    // secret cannot be read back, so a blank box looks the same whether you
    // meant to keep one or forgot to supply one, and the failure that produces
    // surfaces at the token exchange, after the member has granted consent.
    if (!clientSecret) {
      this.snackBar.open(
        'Enter the client secret as well — it cannot be shown back, so it has to be entered with the ID each time.',
        'Dismiss',
        { duration: 6000 },
      );
      return;
    }

    this.submit(provider, { clientId, clientSecret }, 'Sign-in provider saved.');
  }

  switchOff(provider: Provider): void {
    const label = provider === 'google' ? 'Google' : 'Facebook';
    this.dialog
      .open(ConfirmDialogComponent, {
        data: {
          title: `Switch off ${label} sign-in?`,
          message:
            `Members will no longer see the ${label} button, and anyone who signs in that ` +
            `way will need their email address and password instead. The credentials are ` +
            `deleted, so switching it back on means entering them again.`,
          confirmLabel: 'Switch off',
          confirmColor: 'warn' as const,
        },
      })
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed) this.submit(provider, {}, `${label} sign-in switched off.`);
      });
  }

  private submit(provider: Provider, update: OAuthProviderUpdate, message: string): void {
    this.saving.set(provider);
    const request =
      provider === 'google'
        ? this.oauthConfig.setGoogle(update)
        : this.oauthConfig.setFacebook(update);

    request.subscribe({
      next: (config) => {
        this.apply(config);
        this.saving.set(null);
        this.snackBar.open(message, 'Dismiss', { duration: 4000 });
      },
      error: () => {
        this.saving.set(null);
        this.snackBar.open('Could not save. Check the values and try again.', 'Dismiss', {
          duration: 5000,
        });
      },
    });
  }

  copyRedirect(): void {
    const uri = this.config()?.googleRedirectUri;
    if (!uri) return;
    void navigator.clipboard.writeText(uri).then(
      () => this.snackBar.open('Redirect URI copied.', undefined, { duration: 2000 }),
      () => this.snackBar.open('Could not copy — select and copy it manually.', 'Dismiss', {
        duration: 4000,
      }),
    );
  }
}
