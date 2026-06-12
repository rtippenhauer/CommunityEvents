import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatSnackBarModule, MatProgressSpinnerModule],
  template: `
    <div class="login-page">

      <!-- Splash panel -->
      <div class="splash-panel">
        <img
          src="images/dinnerbears-splash.png"
          alt="DinnerBears — Good food. Great company. Bear memories."
          class="splash-image"
        />
      </div>

      <!-- Login panel -->
      <div class="login-panel">
        <div class="login-box">
          <p class="tagline">Good food. Great company. Bear memories.</p>

          @if (inviteToken()) {
            <p class="invite-notice">
              🐾 You have an invite — sign in to claim your seat at the table.
            </p>
          }

          <button mat-raised-button class="google-btn" (click)="signInWithGoogle()">
            <svg class="google-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          @if (fbReady()) {
            <button mat-raised-button class="fb-btn" (click)="signInWithFacebook()" [disabled]="fbLogging()">
              @if (fbLogging()) {
                <mat-spinner diameter="20" />
              } @else {
                <svg class="fb-icon" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="white" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
                Continue with Facebook
              }
            </button>
          }

          <p class="invite-help">
            Don't have an invite? Contact a DinnerBears member to get one.
          </p>
        </div>
      </div>

    </div>
  `,
  styles: [`
    .login-page {
      display: flex;
      min-height: calc(100vh - 64px - 52px);
    }

    /* Splash panel — left half on desktop, full-width hero on mobile */
    .splash-panel {
      flex: 1;
      min-height: 400px;
      overflow: hidden;

      @media (max-width: 767px) {
        flex: none;
        height: 240px;
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

    /* Login panel — right half on desktop, below hero on mobile */
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
      gap: 20px;
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

    .google-btn, .fb-btn {
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
      box-shadow: 0 1px 3px rgba(0,0,0,.12) !important;
      margin-bottom: 12px;
      &:hover { box-shadow: 0 2px 6px rgba(0,0,0,.18) !important; }
    }

    .fb-btn {
      background: #1877F2 !important;
      color: #fff !important;
      border: none !important;
      box-shadow: 0 1px 3px rgba(0,0,0,.2) !important;
      &:hover { background: #166fe5 !important; box-shadow: 0 2px 6px rgba(0,0,0,.3) !important; }
    }

    .fb-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }

    .google-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }

    .invite-help {
      font-size: 0.8rem;
      color: #999;
      margin: 0;
    }
  `],
})
export class LoginComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);
  readonly fbLogging = signal(false);

  readonly inviteToken = signal<string | null>(null);
  readonly fbReady = signal(false);
  readonly fbStatus = signal<'connected' | 'not_authorized' | 'unknown'>('unknown');

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
      FB.login((response: any) => {
        if (response.status === 'connected') {
          this.fbStatus.set('connected');
          this.handleFbToken(response.authResponse.accessToken);
        }
      }, { scope: 'public_profile,email' });
    }
  }

  private handleFbToken(accessToken: string): void {
    this.fbLogging.set(true);
    this.authService.loginWithFacebook(accessToken, this.inviteToken() ?? undefined).subscribe({
      error: (err) => {
        this.fbLogging.set(false);
        const msg = err?.error?.message ?? 'Facebook sign-in failed. Please try again.';
        this.snackBar.open(msg, 'OK', { duration: 5000 });
      },
    });
  }
}
