import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { Clipboard } from '@angular/cdk/clipboard';
import { BrandConfigService } from '../../../core/services/brand-config.service';
import {
  IntegrationsService,
  type ApiTokenRow,
  type IntegrationAccount,
} from '../../../core/services/integrations.service';

/**
 * Admin → Automation Accounts (v2-29).
 *
 * Where a community creates the account an outside integration acts as, and
 * issues its token. Without this screen the feature is unreachable by a human:
 * the API is complete and every route needs a token that only this page can
 * mint -- the same omission `v2-43` found, where credit was a link no screen
 * ever wrote.
 *
 * **The token is shown exactly once.** Only its SHA-256 is stored, so there is
 * no endpoint that can return it again and a lost token is reissued rather than
 * recovered. That is why the new-token panel is a deliberate, dismissible block
 * rather than a snackbar: a toast that vanishes after four seconds is not a
 * reasonable place to put a credential somebody has to copy into another app.
 */
@Component({
  selector: 'app-admin-integrations',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    DatePipe,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatChipsModule,
    MatIconModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatSlideToggleModule,
    MatSelectModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="integrations">
      <h2>Automation Accounts</h2>
      <p class="lede">
        Accounts for outside integrations, such as the Muse Facebook sync. They are
        not people: they cannot sign in, they never receive email, and they are
        hidden from the member directory and the leaderboard.
      </p>

      <mat-card class="endpoint-card" appearance="outlined">
        <mat-card-content>
          <h3><mat-icon>link</mat-icon> Point Muse at this community</h3>
          <p class="hint">
            This address is specific to this community. Muse holds one base URL
            and one token per community it syncs.
          </p>
          <div class="token-row">
            <code>{{ museBaseUrl }}</code>
            <button
              mat-stroked-button
              type="button"
              (click)="copy(museBaseUrl, 'Address')"
            >
              <mat-icon>content_copy</mat-icon> Copy
            </button>
          </div>
        </mat-card-content>
      </mat-card>

      @if (issued(); as token) {
        <mat-card class="token-card" appearance="outlined">
          <mat-card-content>
            <h3><mat-icon>vpn_key</mat-icon> Your new token</h3>
            <p class="once">
              This is the only time it is shown. Copy it now — we store only a
              hash, so it cannot be shown again. If you lose it, issue another.
            </p>
            <div class="token-row">
              <code>{{ token.token }}</code>
              <button mat-stroked-button type="button" (click)="copy(token.token)">
                <mat-icon>content_copy</mat-icon> Copy
              </button>
            </div>
            <p class="expiry">Expires {{ token.expiresAt | date: 'medium' }}</p>
            <p class="hint">
              Give Muse this token together with the address above.
            </p>
            <button mat-button type="button" (click)="issued.set(null)">Done</button>
          </mat-card-content>
        </mat-card>
      }

      <mat-card class="policy-card" appearance="outlined">
        <mat-card-content>
          <h3><mat-icon>home</mat-icon> Private {{ brand.locationPlural() }}</h3>
          <p class="hint">
            A Facebook event is public far beyond your membership. Some
            {{ brand.locationPluralLower() }} are marked private — usually
            someone's home. For those, Muse normally posts the
            {{ brand.dinnerSingularLower() }} without the address, the map or
            the photos, because a picture of a house gives away the address
            just as well as the address does.
          </p>
          <mat-slide-toggle
            [checked]="sharePrivateVenues()"
            [disabled]="policyBusy()"
            (change)="setSharePrivateVenues($event.checked)"
          >
            Let Muse post the address and photos of private
            {{ brand.locationPluralLower() }}
          </mat-slide-toggle>
          @if (sharePrivateVenues()) {
            <p class="policy-warn">
              <mat-icon>warning</mat-icon>
              Private {{ brand.locationSingularLower() }} addresses and photos
              will appear on public Facebook events. Turn this on only if your
              private {{ brand.locationPluralLower() }} are places you are happy
              to publish.
            </p>
          }
        </mat-card-content>
      </mat-card>

      <mat-card class="create-card" appearance="outlined">
        <mat-card-header><mat-card-title>Add an account</mat-card-title></mat-card-header>
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="create()" class="create-form">
            <mat-form-field appearance="outline">
              <mat-label>Name</mat-label>
              <input matInput formControlName="name" placeholder="Muse" />
              <mat-hint>Becomes an address in this community, e.g. muse&#64;{{ tenantSlug() }}.internal</mat-hint>
            </mat-form-field>
            <button mat-flat-button type="submit" [disabled]="form.invalid || busy()">
              Create
            </button>
          </form>
        </mat-card-content>
      </mat-card>

      @if (loading()) {
        <p class="empty">Loading…</p>
      } @else if (accounts().length === 0) {
        <p class="empty">No automation accounts yet.</p>
      } @else {
        @for (account of accounts(); track account.id) {
          <mat-card class="account-card" appearance="outlined">
            <mat-card-content>
              <div class="account-head">
                <div>
                  <h3>{{ account.fullName }}</h3>
                  <p class="email">{{ account.email }}</p>
                </div>
                <mat-form-field appearance="outline" class="role-field">
                  <mat-label>Acts as</mat-label>
                  <mat-select
                    [value]="account.role"
                    [disabled]="roleBusy() === account.id"
                    (valueChange)="setRole(account, $event)"
                  >
                    <mat-option value="muse">Muse — Facebook sync</mat-option>
                    <mat-option value="automation">Claude Automation</mat-option>
                  </mat-select>
                </mat-form-field>
              </div>

              @if (account.role !== 'muse' && liveToken(account)) {
                <p class="role-note">
                  <mat-icon>pause_circle</mat-icon>
                  This account has a live token, but it will not work until the
                  account acts as Muse again.
                </p>
              }

              <div class="actions">
                <button mat-stroked-button type="button" (click)="issue(account)">
                  <mat-icon>add</mat-icon>
                  {{ liveToken(account) ? 'Replace token' : 'Issue token' }}
                </button>
                @if (liveToken(account)) {
                  <span
                    class="warn"
                    matTooltip="Issuing a new token revokes the current one immediately"
                  >
                    <mat-icon>info</mat-icon> Replacing revokes the current token at once
                  </span>
                }
              </div>

              @if (account.tokens.length > 0) {
                <table class="tokens">
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th>State</th>
                      <th>Last used</th>
                      <th>Expires</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (token of account.tokens; track token.id) {
                      <tr [class.dead]="!token.live">
                        <td><code>{{ token.prefix }}…</code></td>
                        <td>
                          @if (token.live) {
                            <mat-chip class="live">Live</mat-chip>
                          } @else if (token.revokedAt) {
                            <mat-chip>Revoked</mat-chip>
                          } @else {
                            <mat-chip>Expired</mat-chip>
                          }
                        </td>
                        <td>
                          {{ token.lastUsedAt ? (token.lastUsedAt | date: 'short') : 'never' }}
                        </td>
                        <td>{{ token.expiresAt | date: 'short' }}</td>
                        <td>
                          @if (token.live) {
                            <button
                              mat-icon-button
                              type="button"
                              aria-label="Revoke this token"
                              (click)="revoke(token)"
                            >
                              <mat-icon>block</mat-icon>
                            </button>
                          }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </mat-card-content>
          </mat-card>
        }
      }
    </div>
  `,
  styles: [
    `
      .integrations {
        max-width: 60rem;
        margin: 0 auto;
        padding: 1.5rem 1rem;
      }
      h2 {
        color: var(--ce-text);
        margin: 0 0 0.5rem;
      }
      .lede {
        color: var(--ce-text-muted);
        margin: 0 0 1.5rem;
        max-width: 48rem;
      }
      mat-card {
        margin-bottom: 1.25rem;
        background: var(--ce-surface);
      }
      .token-card {
        border-color: var(--ce-primary);
      }
      .endpoint-card h3,
      .token-card h3 {
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
      /* --ce-error-overlay is platform-fixed (v2-11): red means warning in
         every community. It is a 75%-opacity overlay meant to carry WHITE
         text, and there is no --ce-on-error token to pair with it -- so it is
         used here as a pale tint under ordinary --ce-text, the same way the
         success chip below does, with the full-strength colour kept for the
         rule that gives the block its weight. Using it as a solid background
         under --ce-text is dark-on-dark, which is what it was on first
         render. */
      .policy-warn {
        border-left: 3px solid var(--ce-error-overlay);
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        margin: 1rem 0 0;
        padding: 0.75rem;
        border-radius: 4px;
        background: color-mix(in srgb, var(--ce-error-overlay) 20%, transparent);
        color: var(--ce-text);
        font-size: 0.85rem;
        max-width: 42rem;
      }
      .policy-warn mat-icon {
        font-size: 1.15rem;
        width: 1.15rem;
        height: 1.15rem;
        flex: none;
      }
      .policy-card h3 {
        display: flex;
        align-items: center;
        gap: 0.4rem;
      }
      .hint {
        color: var(--ce-text-muted);
        font-size: 0.85rem;
        margin: 0.25rem 0 0.75rem;
        max-width: 42rem;
      }
      .token-card h3 {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 0 0 0.5rem;
        color: var(--ce-text);
      }
      .once {
        color: var(--ce-text-muted);
        margin: 0 0 1rem;
      }
      .token-row {
        display: flex;
        gap: 0.75rem;
        align-items: center;
        flex-wrap: wrap;
      }
      .token-row code {
        flex: 1 1 18rem;
        min-width: 0;
        /* A 48-character credential must wrap rather than scroll off a phone. */
        overflow-wrap: anywhere;
        background: var(--ce-surface-variant);
        border: 1px solid var(--ce-rule);
        border-radius: 4px;
        padding: 0.6rem 0.75rem;
        font-size: 0.85rem;
      }
      .expiry {
        color: var(--ce-text-muted);
        font-size: 0.85rem;
        margin: 0.75rem 0 0.5rem;
      }
      .create-form {
        display: flex;
        gap: 1rem;
        align-items: flex-start;
        flex-wrap: wrap;
      }
      .create-form mat-form-field {
        flex: 1 1 16rem;
      }
      .account-head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .account-head h3 {
        margin: 0;
        color: var(--ce-text);
      }
      .email {
        margin: 0.15rem 0 0;
        color: var(--ce-text-muted);
        font-size: 0.85rem;
        overflow-wrap: anywhere;
      }
      mat-chip.muse {
        background: var(--ce-accent);
        color: var(--ce-on-accent);
      }
      /* --ce-success is the platform-fixed green (v2-11): "this works" means the
         same thing in every community, so it is one of the deliberate
         exceptions to branding. Used as a low-alpha tint, matching
         system-bugs.component.ts, so there is no on-colour to pair with. */
      mat-chip.live {
        background: color-mix(in srgb, var(--ce-success) 35%, transparent);
      }
      .role-field {
        width: 14rem;
        max-width: 100%;
      }
      .role-note {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        margin: 0 0 0.5rem;
        color: var(--ce-text-muted);
        font-size: 0.85rem;
      }
      .role-note mat-icon {
        font-size: 1.05rem;
        width: 1.05rem;
        height: 1.05rem;
      }
      .actions {
        display: flex;
        gap: 1rem;
        align-items: center;
        flex-wrap: wrap;
        margin: 1rem 0;
      }
      .warn {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        color: var(--ce-text-muted);
        font-size: 0.8rem;
      }
      .warn mat-icon {
        font-size: 1rem;
        width: 1rem;
        height: 1rem;
      }
      table.tokens {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.85rem;
      }
      table.tokens th {
        text-align: left;
        color: var(--ce-text-muted);
        font-weight: 600;
        padding: 0.4rem 0.5rem;
        border-bottom: 1px solid var(--ce-rule);
      }
      table.tokens td {
        padding: 0.4rem 0.5rem;
        border-bottom: 1px solid var(--ce-rule);
        color: var(--ce-text);
      }
      tr.dead td {
        opacity: 0.6;
      }
      .empty {
        color: var(--ce-text-muted);
      }
      /* The token table is the one thing that cannot shrink to phone width, so
         it scrolls inside its card rather than widening the page. */
      @media (max-width: 36rem) {
        table.tokens {
          display: block;
          overflow-x: auto;
          white-space: nowrap;
        }
      }
    `,
  ],
})
export class AdminIntegrationsComponent implements OnInit {
  private readonly integrations = inject(IntegrationsService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly clipboard = inject(Clipboard);
  /** Public: the template reads the community's own words for these things. */
  readonly brand = inject(BrandConfigService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly accounts = signal<IntegrationAccount[]>([]);
  readonly loading = signal(true);
  readonly busy = signal(false);
  /** The one and only sighting of a plaintext token. */
  readonly issued = signal<{ token: string; expiresAt: string } | null>(null);

  /**
   * Derived from the browser's own origin, which is correct per community by
   * construction: an admin editing this screen is already on their own
   * community's host, and that host is what the token resolves against.
   *
   * Reading it from `window` rather than from config is deliberate -- `APP_URL`
   * is one value for the whole deployment, so it would hand every community the
   * root tenant's address and send Muse to the wrong one. The same reasoning as
   * `baseUrlFor()` on the API side.
   */
  readonly museBaseUrl = `${window.location.origin}/api/v1/muse`;

  /** Off until this community opts in; the API is the authority, not this. */
  readonly sharePrivateVenues = signal(false);
  /** Empty until the settings call answers; the hint simply omits it until then. */
  readonly tenantSlug = signal('');
  /** The account mid-change, so only its own picker is disabled. */
  readonly roleBusy = signal<number | null>(null);
  readonly policyBusy = signal(false);

  readonly form = this.fb.group({
    name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
  });

  ngOnInit(): void {
    this.load();
    this.integrations.museSettings().subscribe({
      next: (settings) => {
        this.sharePrivateVenues.set(settings.sharePrivateVenues);
        this.tenantSlug.set(settings.communitySlug);
      },
      error: () => this.sharePrivateVenues.set(false),
    });
  }

  /**
   * The toggle reflects what the API confirmed, never what was clicked -- on a
   * failure it snaps back, so the screen cannot show "on" for a community that
   * is still withholding addresses.
   */
  setSharePrivateVenues(checked: boolean): void {
    this.policyBusy.set(true);
    this.integrations.setMuseSettings(checked).subscribe({
      next: (settings) => {
        this.sharePrivateVenues.set(settings.sharePrivateVenues);
        this.policyBusy.set(false);
        this.snackBar.open(
          settings.sharePrivateVenues
            ? `Muse may now post private ${this.brand.locationSingularLower()} addresses and photos`
            : `Private ${this.brand.locationSingularLower()} addresses and photos will be withheld`,
          undefined,
          { duration: 4000 },
        );
      },
      error: (error: { error?: { message?: string } }) => {
        this.sharePrivateVenues.set(!checked);
        this.policyBusy.set(false);
        this.snackBar.open(error.error?.message ?? 'Could not save that', 'Dismiss', {
          duration: 6000,
        });
      },
    });
  }

  /**
   * The picker reflects what the API confirmed. On a failure the list is
   * reloaded rather than the old value restored by hand -- this one decides
   * whether an integration works at all, so the screen must not be able to
   * show a role the server did not accept.
   */
  setRole(account: IntegrationAccount, role: 'muse' | 'automation'): void {
    if (account.role === role) return;
    this.roleBusy.set(account.id);

    this.integrations.setRole(account.id, role).subscribe({
      next: () => {
        this.roleBusy.set(null);
        this.snackBar.open(
          role === 'muse'
            ? `${account.fullName} is acting as Muse`
            : `${account.fullName} is no longer acting as Muse — its token is inactive`,
          undefined,
          { duration: 4000 },
        );
        this.load();
      },
      error: (error: { error?: { message?: string } }) => {
        this.roleBusy.set(null);
        this.snackBar.open(error.error?.message ?? 'Could not change that', 'Dismiss', {
          duration: 6000,
        });
        this.load();
      },
    });
  }

  liveToken(account: IntegrationAccount): ApiTokenRow | undefined {
    return account.tokens.find((token) => token.live);
  }

  create(): void {
    if (this.form.invalid) return;
    this.busy.set(true);

    this.integrations.createAccount(this.form.getRawValue().name).subscribe({
      next: () => {
        this.form.reset({ name: '' });
        this.busy.set(false);
        this.load();
      },
      error: (error: { error?: { message?: string } }) => {
        this.busy.set(false);
        // The API's own explanation, not a generic one. `v2-12` found the admin
        // screen discarding it and leaving an operator with no way to tell a
        // duplicate name from a validation failure.
        this.snackBar.open(error.error?.message ?? 'Could not create the account', 'Dismiss', {
          duration: 6000,
        });
      },
    });
  }

  issue(account: IntegrationAccount): void {
    this.integrations.issueToken(account.id).subscribe({
      next: (token) => {
        this.issued.set({ token: token.token, expiresAt: token.expiresAt });
        this.load();
      },
      error: (error: { error?: { message?: string } }) => {
        this.snackBar.open(error.error?.message ?? 'Could not issue a token', 'Dismiss', {
          duration: 6000,
        });
      },
    });
  }

  revoke(token: ApiTokenRow): void {
    this.integrations.revokeToken(token.id).subscribe({
      next: () => {
        this.snackBar.open('Token revoked', 'Dismiss', { duration: 4000 });
        this.load();
      },
      error: (error: { error?: { message?: string } }) => {
        this.snackBar.open(error.error?.message ?? 'Could not revoke the token', 'Dismiss', {
          duration: 6000,
        });
      },
    });
  }

  copy(value: string, label = 'Token'): void {
    this.clipboard.copy(value);
    this.snackBar.open(`${label} copied`, undefined, { duration: 2500 });
  }

  private load(): void {
    this.loading.set(true);
    this.integrations.list().subscribe({
      next: (accounts) => {
        this.accounts.set(accounts);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.snackBar.open('Could not load automation accounts', 'Dismiss', { duration: 6000 });
      },
    });
  }
}
