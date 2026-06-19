import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { NonNullableFormBuilder, ReactiveFormsModule, FormControl, Validators } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { AccountService, ConnectedProviders } from '../../core/services/account.service';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-account-settings',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDividerModule,
    MatDialogModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <div class="settings-page">
      <h1 class="page-title">Account Settings</h1>

      <!-- Connected Accounts -->
      <mat-card class="settings-card">
        <mat-card-header>
          <mat-card-title>Connected Accounts</mat-card-title>
          <mat-card-subtitle>Manage how you log in to DinnerBears</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          @if (loading()) {
            <div class="loading-row"><mat-spinner diameter="28"></mat-spinner></div>
          } @else if (providers()) {
            <!-- Google -->
            <div class="provider-row">
              <div class="provider-info">
                <svg class="provider-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <div class="provider-text">
                  <span class="provider-name">Google</span>
                  @if (providers()!.google) {
                    <span class="provider-email">{{ providers()!.google!.email }}</span>
                  } @else {
                    <span class="provider-email not-connected">Not connected</span>
                  }
                </div>
              </div>
              @if (providers()!.google) {
                @if (providers()!.hasMultipleMethods) {
                  <button mat-stroked-button color="warn" (click)="confirmDisconnect('google')" [disabled]="disconnecting()">
                    Disconnect
                  </button>
                } @else {
                  <span class="only-method-label">Only login method</span>
                }
              } @else {
                <button mat-stroked-button (click)="connectGoogle()">
                  Connect
                </button>
              }
            </div>

            <mat-divider></mat-divider>

            <!-- Facebook -->
            <div class="provider-row">
              <div class="provider-info">
                <svg class="provider-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
                <div class="provider-text">
                  <span class="provider-name">Facebook</span>
                  @if (providers()!.facebook) {
                    <span class="provider-email">{{ providers()!.facebook!.email ?? 'Connected' }}</span>
                  } @else {
                    <span class="provider-email not-connected">Not connected</span>
                  }
                </div>
              </div>
              @if (providers()!.facebook) {
                @if (providers()!.hasMultipleMethods) {
                  <button mat-stroked-button color="warn" (click)="confirmDisconnect('facebook')" [disabled]="disconnecting()">
                    Disconnect
                  </button>
                } @else {
                  <span class="only-method-label">Only login method</span>
                }
              } @else if (facebookEnabled) {
                <button mat-stroked-button (click)="connectFacebook()" [disabled]="fbLinking() || !fbReady()">
                  @if (fbLinking()) { <mat-spinner diameter="16"></mat-spinner> }
                  @else { Connect }
                </button>
              }
            </div>

            <mat-divider></mat-divider>

            <mat-divider></mat-divider>

            <!-- Email/Password -->
            <div class="provider-row">
              <div class="provider-info">
                <mat-icon class="provider-icon-mat">lock</mat-icon>
                <div class="provider-text">
                  <span class="provider-name">Password</span>
                  @if (providers()!.hasPassword) {
                    <span class="provider-email">Password set</span>
                  } @else {
                    <span class="provider-email not-connected">No password set</span>
                  }
                </div>
              </div>
              @if (providers()!.hasPassword) {
                @if (providers()!.hasMultipleMethods) {
                  <button mat-stroked-button (click)="showChangePasswordDialog.set(true)">Change</button>
                } @else {
                  <span class="only-method-label">Only login method</span>
                }
              } @else {
                <button mat-stroked-button (click)="openSetPasswordDialog()">Set password</button>
              }
            </div>
          }
        </mat-card-content>
      </mat-card>

      <!-- Danger Zone -->
      @if (currentUser()?.role !== 'admin') {
        <mat-card class="settings-card danger-zone-card">
          <mat-card-header>
            <mat-card-title class="danger-title">Danger Zone</mat-card-title>
          </mat-card-header>
          <mat-card-content>
            <p class="danger-description">
              Permanently delete your DinnerBears account and all associated login credentials.
              Your name and email will be deleted within 30 days.
            </p>
            <button mat-raised-button color="warn" (click)="startDeleteFlow()" [disabled]="deleting()">
              <mat-icon>delete_forever</mat-icon>
              Delete My Account
            </button>
          </mat-card-content>
        </mat-card>
      } @else {
        <mat-card class="settings-card">
          <mat-card-content>
            <p class="admin-note">
              <mat-icon>info</mat-icon>
              Admin accounts cannot be self-deleted. Contact another administrator.
            </p>
          </mat-card-content>
        </mat-card>
      }

      <!-- Set password dialog (first time — no current password needed) -->
      @if (showSetPasswordDialog()) {
        <div class="dialog-backdrop" (click)="showSetPasswordDialog.set(false)">
          <div class="dialog-panel" (click)="$event.stopPropagation()">
            <h2>Set a password</h2>
            <p>Add a password so you can sign in with email in addition to your connected accounts.</p>
            <form [formGroup]="setPasswordForm" (ngSubmit)="submitSetPassword()" class="pw-form">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Email for sign-in</mat-label>
                <input matInput formControlName="email" type="email" autocomplete="email" />
                <mat-hint>This is the email you'll use to sign in with a password</mat-hint>
              </mat-form-field>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>New password</mat-label>
                <input matInput formControlName="newPassword"
                  [type]="showChangePw() ? 'text' : 'password'" autocomplete="new-password" />
                <button mat-icon-button matSuffix type="button" (click)="showChangePw.set(!showChangePw())">
                  <mat-icon>{{ showChangePw() ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
                <mat-hint>At least 8 characters</mat-hint>
              </mat-form-field>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Confirm password</mat-label>
                <input matInput formControlName="confirmPassword"
                  [type]="showChangePw() ? 'text' : 'password'" autocomplete="new-password" />
              </mat-form-field>
              @if (changePasswordError()) {
                <p class="form-error">{{ changePasswordError() }}</p>
              }
              <div class="dialog-actions">
                <button mat-button type="button" (click)="showSetPasswordDialog.set(false)">Cancel</button>
                <button mat-raised-button color="primary" type="submit"
                  [disabled]="setPasswordForm.invalid || changingPassword()">
                  @if (changingPassword()) { <mat-spinner diameter="18" /> }
                  @else { Set password }
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Change password dialog -->
      @if (showChangePasswordDialog()) {
        <div class="dialog-backdrop" (click)="showChangePasswordDialog.set(false)">
          <div class="dialog-panel" (click)="$event.stopPropagation()">
            <h2>Change password</h2>
            <form [formGroup]="changePasswordForm" (ngSubmit)="submitChangePassword()" class="pw-form">
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Current password</mat-label>
                <input matInput formControlName="currentPassword"
                  [type]="showChangePw() ? 'text' : 'password'" autocomplete="current-password" />
                <button mat-icon-button matSuffix type="button" (click)="showChangePw.set(!showChangePw())">
                  <mat-icon>{{ showChangePw() ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
              </mat-form-field>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>New password</mat-label>
                <input matInput formControlName="newPassword"
                  [type]="showChangePw() ? 'text' : 'password'" autocomplete="new-password" />
                <mat-hint>At least 8 characters</mat-hint>
              </mat-form-field>
              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Confirm new password</mat-label>
                <input matInput formControlName="confirmPassword"
                  [type]="showChangePw() ? 'text' : 'password'" autocomplete="new-password" />
              </mat-form-field>
              @if (changePasswordError()) {
                <p class="form-error">{{ changePasswordError() }}</p>
              }
              <div class="dialog-actions">
                <button mat-button type="button" (click)="showChangePasswordDialog.set(false)">Cancel</button>
                <button mat-raised-button color="primary" type="submit"
                  [disabled]="changePasswordForm.invalid || changingPassword()">
                  @if (changingPassword()) { <mat-spinner diameter="18" /> }
                  @else { Update password }
                </button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Disconnect confirmation dialog -->
      @if (showDisconnectDialog()) {
        <div class="dialog-backdrop" (click)="cancelDisconnect()">
          <div class="dialog-panel" (click)="$event.stopPropagation()">
            <h2>Disconnect {{ pendingProvider() | titlecase }}?</h2>
            <p>You will no longer be able to log in with {{ pendingProvider() | titlecase }}. Your DinnerBears account and all history will remain.</p>
            <div class="dialog-actions">
              <button mat-button (click)="cancelDisconnect()">Cancel</button>
              <button mat-raised-button color="warn" (click)="executeDisconnect()" [disabled]="disconnecting()">
                Disconnect {{ pendingProvider() | titlecase }}
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Only-auth-method warning dialog -->
      @if (showOnlyAuthDialog()) {
        <div class="dialog-backdrop" (click)="cancelDisconnect()">
          <div class="dialog-panel" (click)="$event.stopPropagation()">
            <mat-icon class="dialog-warn-icon">warning</mat-icon>
            <h2>{{ pendingProvider() | titlecase }} is your only way to log in</h2>
            <p>Disconnecting it will permanently delete your account.</p>
            <p class="hint">To keep your account, cancel and add another login method first.</p>
            <div class="dialog-actions">
              <button mat-button (click)="cancelDisconnect()">Cancel</button>
              <button mat-raised-button color="warn" (click)="startDeleteFlow(); cancelDisconnect()">
                Delete My Account Instead
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Delete step 1 dialog -->
      @if (showDeleteStep1()) {
        <div class="dialog-backdrop">
          <div class="dialog-panel" (click)="$event.stopPropagation()">
            <mat-icon class="dialog-warn-icon">delete_forever</mat-icon>
            <h2>Delete your DinnerBears account?</h2>
            <ul class="delete-details">
              <li>Your account will be <strong>immediately deactivated</strong>.</li>
              <li>All login credentials are removed now.</li>
              <li>Your name and email will be <strong>permanently deleted within 30 days</strong>.</li>
              <li>Event attendance history is retained anonymously.</li>
            </ul>
            <p class="hint">You will be logged out immediately and cannot undo this.</p>
            <div class="dialog-actions">
              <button mat-button (click)="showDeleteStep1.set(false)">Cancel</button>
              <button mat-raised-button color="warn" (click)="showDeleteStep1.set(false); showDeleteStep2.set(true)">
                Continue
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Delete step 2 dialog — type-to-confirm -->
      @if (showDeleteStep2()) {
        <div class="dialog-backdrop">
          <div class="dialog-panel" (click)="$event.stopPropagation()">
            <h2>Confirm account deletion</h2>
            <p>Type <strong>DELETE</strong> to confirm:</p>
            <mat-form-field appearance="outline" class="confirm-field">
              <input matInput [formControl]="deleteConfirmCtrl" placeholder="DELETE" autocomplete="off" />
            </mat-form-field>
            <div class="dialog-actions">
              <button mat-button (click)="showDeleteStep2.set(false); deleteConfirmCtrl.reset()">Cancel</button>
              <button
                mat-raised-button
                color="warn"
                [disabled]="deleteConfirmCtrl.value !== 'DELETE' || deleting()"
                (click)="executeDelete()"
              >
                Permanently Delete My Account
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .settings-page {
      max-width: 640px;
      margin: 40px auto;
      padding: 0 16px 80px;
    }

    .page-title {
      font-size: 1.6rem;
      color: var(--db-brown-dark, #3d2b1f);
      margin: 0 0 24px;
    }

    .settings-card {
      margin-bottom: 24px;
      border-radius: 12px;
    }

    .loading-row {
      display: flex;
      justify-content: center;
      padding: 24px 0;
    }

    .provider-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 0;
    }

    .provider-info {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .provider-icon {
      width: 28px;
      height: 28px;
      flex-shrink: 0;
    }

    .provider-icon-mat {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: #888;
    }

    .provider-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .provider-name {
      font-weight: 500;
      font-size: 0.95rem;
    }

    .provider-email {
      font-size: 0.82rem;
      color: #666;
    }

    .provider-email.not-connected {
      color: #aaa;
      font-style: italic;
    }

    .only-method-label {
      font-size: 0.8rem;
      color: #888;
      font-style: italic;
    }

    .danger-zone-card {
      border: 2px solid #d32f2f;
    }

    .danger-title {
      color: #d32f2f !important;
    }

    .danger-description {
      color: #555;
      font-size: 0.9rem;
      margin: 0 0 16px;
    }

    .admin-note {
      display: flex;
      align-items: center;
      gap: 8px;
      color: #888;
      font-size: 0.9rem;
    }

    /* Dialogs */
    .dialog-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .dialog-panel {
      background: #fff;
      border-radius: 12px;
      padding: 32px;
      max-width: 480px;
      width: calc(100vw - 32px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    }

    .dialog-panel h2 {
      margin: 0 0 12px;
      font-size: 1.2rem;
    }

    .dialog-panel p {
      color: #555;
      font-size: 0.92rem;
      margin: 0 0 12px;
      line-height: 1.55;
    }

    .dialog-warn-icon {
      font-size: 2.5rem;
      width: 2.5rem;
      height: 2.5rem;
      color: #e65100;
      margin-bottom: 8px;
      display: block;
    }

    .dialog-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      margin-top: 20px;
    }

    .delete-details {
      color: #555;
      font-size: 0.9rem;
      line-height: 1.7;
      padding-left: 20px;
      margin: 0 0 12px;
    }

    .hint {
      font-size: 0.85rem !important;
      color: #888 !important;
      font-style: italic;
    }

    .confirm-field {
      width: 100%;
      margin-top: 4px;
    }

    .pw-form {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 8px;
    }

    .full-width { width: 100%; }

    .form-error {
      color: #c62828;
      font-size: 0.82rem;
      margin: 4px 0 0;
    }
  `],
})
export class AccountSettingsComponent implements OnInit {
  private readonly accountService = inject(AccountService);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly providers = signal<ConnectedProviders | null>(null);
  readonly loading = signal(true);
  readonly disconnecting = signal(false);
  readonly deleting = signal(false);

  readonly showDisconnectDialog = signal(false);
  readonly showOnlyAuthDialog = signal(false);
  readonly showDeleteStep1 = signal(false);
  readonly showDeleteStep2 = signal(false);
  readonly pendingProvider = signal<'google' | 'facebook' | null>(null);

  readonly deleteConfirmCtrl = new FormControl('');

  readonly showChangePasswordDialog = signal(false);
  readonly showSetPasswordDialog = signal(false);
  readonly changingPassword = signal(false);
  readonly changePasswordError = signal<string | null>(null);
  readonly showChangePw = signal(false);

  private readonly fb = inject(NonNullableFormBuilder);
  readonly setPasswordForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  });

  readonly changePasswordForm = this.fb.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  });

  readonly facebookEnabled = !!environment.facebookAppId;
  readonly fbReady = signal(false);
  readonly fbLinking = signal(false);

  get currentUser() {
    return this.authService.currentUser;
  }

  ngOnInit(): void {
    this.loadProviders();
    if (environment.facebookAppId) {
      this.loadFbSdk(environment.facebookAppId);
    }
  }

  private loadProviders(): void {
    this.loading.set(true);
    this.accountService.getConnectedProviders().subscribe({
      next: (p) => { this.providers.set(p); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  confirmDisconnect(provider: 'google' | 'facebook'): void {
    this.pendingProvider.set(provider);
    this.showDisconnectDialog.set(true);
  }

  cancelDisconnect(): void {
    this.showDisconnectDialog.set(false);
    this.showOnlyAuthDialog.set(false);
    this.pendingProvider.set(null);
  }

  async executeDisconnect(): Promise<void> {
    const provider = this.pendingProvider();
    if (!provider) return;
    this.disconnecting.set(true);
    try {
      await firstValueFrom(this.accountService.disconnectProvider(provider));
      this.showDisconnectDialog.set(false);
      this.pendingProvider.set(null);
      this.snackBar.open(`${provider.charAt(0).toUpperCase() + provider.slice(1)} disconnected successfully.`, 'OK', { duration: 4000 });
      this.loadProviders();
    } catch (err) {
      const status = (err as HttpErrorResponse)?.status;
      const errorCode = (err as HttpErrorResponse)?.error?.error;
      this.showDisconnectDialog.set(false);
      if (status === 409 && errorCode === 'ONLY_AUTH_METHOD') {
        this.showOnlyAuthDialog.set(true);
      } else {
        this.snackBar.open('Something went wrong. Please try again.', 'OK', { duration: 4000 });
        this.pendingProvider.set(null);
      }
    } finally {
      this.disconnecting.set(false);
    }
  }

  connectGoogle(): void {
    window.location.href = '/api/v1/auth/google';
  }

  connectFacebook(): void {
    if (!environment.facebookAppId) return;
    const win = window as any;
    if (!win.FB || !win.__fbDone) {
      this.loadFbSdk(environment.facebookAppId);
      return;
    }
    this.fbLinking.set(true);
    win.FB.login((response: any) => {
      if (response.status !== 'connected') {
        this.fbLinking.set(false);
        return;
      }
      this.authService.linkFacebook(response.authResponse.accessToken).subscribe({
        next: () => {
          this.fbLinking.set(false);
          this.snackBar.open('Facebook account connected!', 'OK', { duration: 3000 });
          this.loadProviders();
        },
        error: (err: HttpErrorResponse) => {
          this.fbLinking.set(false);
          this.snackBar.open(err?.error?.message ?? 'Failed to connect Facebook.', 'OK', { duration: 5000 });
        },
      });
    }, { scope: 'public_profile,email' });
  }

  private loadFbSdk(appId: string): void {
    const win = window as any;
    if (win.__fbDone) { this.fbReady.set(true); return; }
    const onReady = () => {
      if (!win.__fbDone) {
        win.FB.init({ appId, cookie: true, xfbml: false, version: 'v22.0' });
        win.__fbDone = true;
      }
      win.FB.getLoginStatus(() => this.fbReady.set(true));
    };
    if (win.FB) { onReady(); return; }
    win.fbAsyncInit = onReady;
    if (!document.getElementById('facebook-jssdk')) {
      const js = document.createElement('script');
      js.id = 'facebook-jssdk';
      js.src = 'https://connect.facebook.net/en_US/sdk.js';
      document.head.appendChild(js);
    }
  }

  openSetPasswordDialog(): void {
    const currentEmail = this.authService.currentUser()?.email ?? '';
    this.setPasswordForm.reset({ email: currentEmail, newPassword: '', confirmPassword: '' });
    this.changePasswordError.set(null);
    this.showSetPasswordDialog.set(true);
  }

  submitSetPassword(): void {
    this.changePasswordError.set(null);
    const { email, newPassword, confirmPassword } = this.setPasswordForm.getRawValue();
    if (newPassword !== confirmPassword) { this.changePasswordError.set('Passwords do not match.'); return; }
    this.changingPassword.set(true);
    this.authService.setPassword(email, newPassword).subscribe({
      next: (res) => {
        this.changingPassword.set(false);
        this.showSetPasswordDialog.set(false);
        this.setPasswordForm.reset();
        if (res.needsVerification) {
          this.snackBar.open(`Password set. Check ${email} to verify your address before signing in with it.`, 'OK', { duration: 7000 });
        } else {
          this.snackBar.open('Password set successfully.', 'OK', { duration: 3000 });
        }
        this.loadProviders();
      },
      error: (err) => {
        this.changingPassword.set(false);
        const msg = err?.error?.message ?? '';
        if (msg === 'email_taken') {
          this.changePasswordError.set('That email is already associated with another account.');
        } else {
          this.changePasswordError.set('Something went wrong. Please try again.');
        }
      },
    });
  }

  submitChangePassword(): void {
    this.changePasswordError.set(null);
    const { currentPassword, newPassword, confirmPassword } = this.changePasswordForm.getRawValue();
    if (newPassword !== confirmPassword) {
      this.changePasswordError.set('New passwords do not match.');
      return;
    }
    this.changingPassword.set(true);
    this.authService.changePassword(currentPassword, newPassword).subscribe({
      next: () => {
        this.changingPassword.set(false);
        this.showChangePasswordDialog.set(false);
        this.changePasswordForm.reset();
        this.snackBar.open('Password updated.', 'OK', { duration: 3000 });
      },
      error: (err) => {
        this.changingPassword.set(false);
        const msg = err?.error?.message ?? '';
        if (msg === 'invalid_credentials') {
          this.changePasswordError.set('Current password is incorrect.');
        } else {
          this.changePasswordError.set('Something went wrong. Please try again.');
        }
      },
    });
  }

  startDeleteFlow(): void {
    this.showDeleteStep1.set(true);
  }

  async executeDelete(): Promise<void> {
    if (this.deleteConfirmCtrl.value !== 'DELETE') return;
    this.deleting.set(true);
    try {
      await firstValueFrom(this.accountService.deleteAccount());
      this.showDeleteStep2.set(false);
      this.authService.currentUser.set(null);
      await this.router.navigate(['/'], { queryParams: { deleted: '1' } });
    } catch {
      this.snackBar.open('Something went wrong. Please try again.', 'OK', { duration: 4000 });
    } finally {
      this.deleting.set(false);
    }
  }
}
