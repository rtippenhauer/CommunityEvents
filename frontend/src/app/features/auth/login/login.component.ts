import { Component, inject, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';
import { BrandConfigService } from '../../../core/services/brand-config.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
  ],
  template: `
    <div class="login-page">
      <!-- Splash panel -->
      <div class="splash-panel">
        <img
          [src]="brandConfig.splashSrc()"
          [alt]="brandConfig.brand().name + ' — ' + brandConfig.brand().tagline"
          class="splash-image"
        />
      </div>

      <!-- Login panel -->
      <div class="login-panel">
        <div class="login-box">
          <p class="tagline">{{ brandConfig.brand().tagline }}</p>

          @if (inviteToken()) {
            <p class="invite-notice">
              🐾 You have an invite — sign in or create an account to claim your seat at the table.
            </p>
          }

          <!-- OAuth buttons -->
          <button mat-raised-button class="google-btn" (click)="signInWithGoogle()">
            <svg class="google-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Continue with Google
          </button>

          @if (fbReady()) {
            <button
              mat-raised-button
              class="fb-btn"
              (click)="signInWithFacebook()"
              [disabled]="fbLogging()"
            >
              @if (fbLogging()) {
                <mat-spinner diameter="20" />
              } @else {
                <svg class="fb-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="white"
                    d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"
                  />
                </svg>
                Continue with Facebook
              }
            </button>
          }

          <!-- Divider -->
          <div class="divider"><span>or</span></div>

          <!-- Email / password form -->
          @if (showEmailForm()) {
            <form [formGroup]="form" (ngSubmit)="submitEmailForm()" class="email-form">
              @if (inviteToken()) {
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Full name</mat-label>
                  <input matInput formControlName="fullName" autocomplete="name" />
                </mat-form-field>
              }

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Email</mat-label>
                <input matInput formControlName="email" type="email" autocomplete="email" />
              </mat-form-field>

              <mat-form-field appearance="outline" class="full-width">
                <mat-label>Password</mat-label>
                <input
                  matInput
                  formControlName="password"
                  [type]="showPassword() ? 'text' : 'password'"
                  [autocomplete]="inviteToken() ? 'new-password' : 'current-password'"
                />
                <button
                  mat-icon-button
                  matSuffix
                  type="button"
                  (click)="showPassword.set(!showPassword())"
                >
                  <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
                </button>
              </mat-form-field>

              @if (inviteToken()) {
                <mat-form-field appearance="outline" class="full-width">
                  <mat-label>Confirm password</mat-label>
                  <input
                    matInput
                    formControlName="confirmPassword"
                    [type]="showPassword() ? 'text' : 'password'"
                    autocomplete="new-password"
                  />
                </mat-form-field>
              }

              @if (formError()) {
                <p class="form-error">{{ formError() }}</p>
              }

              <button
                mat-raised-button
                color="primary"
                type="submit"
                class="full-width"
                [disabled]="form.invalid || submitting()"
              >
                @if (submitting()) {
                  <mat-spinner diameter="20" />
                } @else {
                  {{ inviteToken() ? 'Create account' : 'Sign in' }}
                }
              </button>

              @if (!inviteToken()) {
                <a routerLink="/auth/forgot-password" class="forgot-link">Forgot password?</a>
              }
            </form>
          } @else {
            <button mat-button class="email-toggle-btn" (click)="showEmailForm.set(true)">
              <mat-icon>mail</mat-icon>
              {{ inviteToken() ? 'Sign up with email' : 'Sign in with email' }}
            </button>
          }

          <p class="invite-help">Don't have an invite? Contact a {{ brandConfig.brand().name }} member to get one.</p>
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .login-page {
        display: flex;
        min-height: calc(100vh - 64px - 52px);
      }

      .splash-panel {
        flex: 1;
        min-height: 400px;
        overflow: hidden;

        @media (max-width: 767px) {
          flex: none;
          height: 240px;
          min-height: 0;
          width: 100%;
        }
      }

      .splash-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center top;
        display: block;
      }

      .login-panel {
        flex: 0 0 420px;
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: var(--db-cream);
        padding: 32px 24px;

        @media (max-width: 767px) {
          flex: none;
          width: 100%;
          padding: 24px 16px;
        }
      }

      .login-page {
        flex-direction: row;

        @media (max-width: 767px) {
          flex-direction: column;
        }
      }

      .login-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        width: 100%;
        max-width: 340px;
        text-align: center;
      }

      .tagline {
        font-size: 1rem;
        color: var(--db-text-mid);
        margin: 0;
        font-style: italic;
      }

      .invite-notice {
        background: var(--db-cream-dark);
        border-left: 3px solid var(--db-primary);
        padding: 10px 14px;
        border-radius: 0 6px 6px 0;
        font-size: 0.875rem;
        color: var(--db-text-mid);
        margin: 0;
        width: 100%;
        text-align: left;
      }

      .google-btn,
      .fb-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        padding: 10px 20px;
        font-size: 1rem;
        font-weight: 500;
        border-radius: 8px !important;
      }

      .google-btn {
        background: #fff !important;
        color: var(--db-text-dark) !important;
        border: 1px solid #dadce0 !important;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12) !important;
        &:hover {
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18) !important;
        }
      }

      .fb-btn {
        background: #1877f2 !important;
        color: #fff !important;
        border: none !important;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2) !important;
        &:hover {
          background: #166fe5 !important;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3) !important;
        }
      }

      .fb-icon,
      .google-icon {
        width: 20px;
        height: 20px;
        flex-shrink: 0;
      }

      .divider {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 12px;
        color: #bbb;
        font-size: 0.8rem;

        &::before,
        &::after {
          content: '';
          flex: 1;
          height: 1px;
          background: #ddd;
        }
      }

      .email-form {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 4px;
        text-align: left;
      }

      .full-width {
        width: 100%;
      }

      .form-error {
        color: #c62828;
        font-size: 0.82rem;
        margin: 0;
        text-align: center;
      }

      .forgot-link {
        font-size: 0.8rem;
        color: var(--db-primary);
        text-decoration: none;
        text-align: center;
        &:hover {
          text-decoration: underline;
        }
      }

      .email-toggle-btn {
        color: var(--db-primary);
        font-size: 0.9rem;
      }

      .invite-help {
        font-size: 0.8rem;
        color: #999;
        margin: 0;
      }
    `,
  ],
})
export class LoginComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  readonly brandConfig = inject(BrandConfigService);
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly snackBar = inject(MatSnackBar);

  readonly fbLogging = signal(false);
  readonly inviteToken = signal<string | null>(null);
  readonly fbReady = signal(false);
  readonly fbStatus = signal<'connected' | 'not_authorized' | 'unknown'>('unknown');
  readonly showEmailForm = signal(false);
  readonly showPassword = signal(false);
  readonly submitting = signal(false);
  readonly formError = signal<string | null>(null);

  readonly form = this.fb.group({
    fullName: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: [''],
  });

  ngOnInit(): void {
    if (this.authService.isLoggedIn()) {
      void this.router.navigate(['/profile']);
      return;
    }
    const token = this.route.snapshot.queryParamMap.get('token');
    this.inviteToken.set(token);

    if (environment.facebookAppId) {
      this.loadFbSdk(environment.facebookAppId);
    }
  }

  private loadFbSdk(appId: string): void {
    const win = window as any;

    const onReady = () => {
      if (!win.__fbDone) {
        win.FB.init({ appId, cookie: true, xfbml: true, version: 'v22.0' });
        win.__fbDone = true;
        win.FB.AppEvents.logPageView();
      }
      win.FB.getLoginStatus((response: { status: string }) => {
        this.fbStatus.set(response.status as 'connected' | 'not_authorized' | 'unknown');
        this.fbReady.set(true);
      });
    };

    if (win.__fbDone) {
      win.FB.getLoginStatus((response: { status: string }) => {
        this.fbStatus.set(response.status as 'connected' | 'not_authorized' | 'unknown');
        this.fbReady.set(true);
      });
      return;
    }

    if (win.FB) {
      onReady();
      return;
    }

    win.fbAsyncInit = onReady;

    if (!document.getElementById('facebook-jssdk')) {
      const js = document.createElement('script');
      js.id = 'facebook-jssdk';
      js.src = 'https://connect.facebook.net/en_US/sdk.js';
      document.head.appendChild(js);
    }
  }

  signInWithGoogle(): void {
    this.authService.loginWithGoogle(this.inviteToken() ?? undefined);
  }

  signInWithFacebook(): void {
    const FB = (window as any).FB;
    if (!FB) return;

    if (this.fbStatus() === 'connected') {
      FB.getLoginStatus((response: any) => {
        if (response.status === 'connected') {
          this.handleFbToken(response.authResponse.accessToken);
        }
      });
    } else {
      FB.login(
        (response: any) => {
          if (response.status === 'connected') {
            this.fbStatus.set('connected');
            this.handleFbToken(response.authResponse.accessToken);
          }
        },
        { scope: 'public_profile,email,user_link' },
      );
    }
  }

  private handleFbToken(accessToken: string): void {
    this.fbLogging.set(true);
    this.authService.loginWithFacebook(accessToken, this.inviteToken() ?? undefined).subscribe({
      error: (err) => {
        this.fbLogging.set(false);
        const reason = (err?.error?.reason as string) ?? 'fb_error';
        void this.router.navigate(['/auth/error'], { queryParams: { reason } });
      },
    });
  }

  submitEmailForm(): void {
    this.formError.set(null);
    const { fullName, email, password, confirmPassword } = this.form.getRawValue();
    const token = this.inviteToken();

    if (token) {
      // Registration
      if (!fullName.trim()) {
        this.formError.set('Please enter your name.');
        return;
      }
      if (password !== confirmPassword) {
        this.formError.set('Passwords do not match.');
        return;
      }

      this.submitting.set(true);
      this.authService.registerWithPassword(token, fullName.trim(), email, password).subscribe({
        next: () => {
          void this.router.navigate(['/auth/verify-email-sent'], { queryParams: { email } });
        },
        error: (err) => {
          this.submitting.set(false);
          const reason = err?.error?.reason ?? err?.error?.message ?? '';
          if (reason === 'email_taken')
            this.formError.set('An account with that email already exists.');
          else if (reason === 'invite_expired')
            this.formError.set('Your invite link has expired. Ask for a new one.');
          else if (reason === 'invite_used')
            this.formError.set('This invite link has already been used.');
          else if (reason === 'invite_email_mismatch')
            this.formError.set('This invite was sent to a different email address.');
          else this.formError.set('Registration failed. Please try again.');
        },
      });
    } else {
      // Login
      this.submitting.set(true);
      this.authService.loginWithPassword(email, password).subscribe({
        next: (res) => {
          this.submitting.set(false);
          const lastLogin = res?.previousLastLoginAt
            ? new Date(res.previousLastLoginAt).toLocaleString()
            : null;
          const failed = res?.failedAttemptsSinceLastLogin ?? 0;
          if (failed > 0) {
            const noun = failed === 1 ? 'attempt' : 'attempts';
            const since = lastLogin ? ` since ${lastLogin}` : '';
            this.snackBar.open(`⚠ ${failed} failed login ${noun}${since}`, 'Dismiss', {
              duration: 12000,
              panelClass: 'snack-warn',
            });
          } else if (lastLogin) {
            this.snackBar.open(`Last login: ${lastLogin}`, 'OK', { duration: 5000 });
          }
        },
        error: (err) => {
          this.submitting.set(false);
          const body = err?.error ?? {};
          const msg = body.message ?? '';
          if (msg === 'email_not_verified') {
            void this.router.navigate(['/auth/verify-email-sent'], {
              queryParams: { email, resend: true },
            });
          } else if (msg === 'account_locked') {
            this.formError.set('Too many failed attempts. Please try again in a few minutes.');
          } else {
            this.formError.set('Invalid email or password.');
          }
        },
      });
    }
  }
}
