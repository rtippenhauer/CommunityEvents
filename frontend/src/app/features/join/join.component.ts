import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { InvitesService, InvitePreview } from '../../core/services/invites.service';
import { AuthService } from '../../core/services/auth.service';
import { environment } from '../../../environments/environment';

type PageState = 'loading' | 'ready' | 'invalid' | 'expired' | 'full' | 'revoked';

@Component({
  selector: 'app-join',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatCardModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="join-page">
      <div class="brand-header">
        <img src="/images/DinnerBearsIcon.png" alt="DinnerBears" class="brand-logo" />
        <p class="brand-tagline">Good food. Great company. Bear memories.</p>
      </div>

      @switch (state()) {
        @case ('loading') {
          <div class="center"><mat-spinner /></div>
        }

        @case ('ready') {
          <div class="join-card">
            @if (preview()?.event?.restaurantPhotoUrl) {
              <div class="event-photo">
                <img [src]="preview()!.event!.restaurantPhotoUrl!" [alt]="preview()!.event!.restaurantName" />
              </div>
            }

            <div class="card-body">
              <p class="join-label">
                <mat-icon class="label-icon">group_add</mat-icon>
                You're invited to DinnerBears!
              </p>

              <h1 class="event-title">{{ preview()!.event!.title }}</h1>

              <div class="event-meta">
                <div class="meta-row">
                  <mat-icon>event</mat-icon>
                  <span>{{ preview()!.event!.eventDate | date: 'EEEE, MMMM d, y' }} at {{ formatTime(preview()!.event!.eventTime) }}</span>
                </div>
                <div class="meta-row">
                  <mat-icon>restaurant</mat-icon>
                  <span>{{ preview()!.event!.restaurantName }}</span>
                </div>
                <div class="meta-row">
                  <mat-icon>location_on</mat-icon>
                  <span>{{ preview()!.event!.restaurantAddress }}</span>
                </div>
              </div>

              @if (preview()!.flavor === 'non_validated') {
                <p class="access-note">
                  <mat-icon class="note-icon">info_outline</mat-icon>
                  You'll join as a guest member — you can RSVP and view events right away.
                  A moderator can upgrade you to full membership after meeting you at dinner.
                </p>
              }

              <div class="auth-buttons">
                <button mat-raised-button class="auth-btn google-btn" (click)="signInWithGoogle()">
                  <svg class="provider-icon" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>

                @if (fbReady()) {
                  <button mat-raised-button class="auth-btn fb-btn" (click)="signInWithFacebook()" [disabled]="fbLogging()">
                    @if (fbLogging()) {
                      <mat-spinner diameter="20" />
                    } @else {
                      <svg class="provider-icon" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="white" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                      Continue with Facebook
                    }
                  </button>
                }
              </div>

              <p class="expires-note">
                This invite expires {{ preview()!.expiresAt | date: 'MMM d, y' }}.
              </p>
            </div>
          </div>
        }

        @case ('expired') {
          <div class="status-card error">
            <mat-icon class="status-icon">schedule</mat-icon>
            <h2>This invite has expired</h2>
            <p>This invite link is no longer valid. Please ask a DinnerBears member for a new one.</p>
          </div>
        }

        @case ('full') {
          <div class="status-card error">
            <mat-icon class="status-icon">group_off</mat-icon>
            <h2>This invite link is full</h2>
            <p>This invite has reached its maximum number of uses. Please ask a DinnerBears member for a new one.</p>
          </div>
        }

        @case ('revoked') {
          <div class="status-card error">
            <mat-icon class="status-icon">block</mat-icon>
            <h2>This invite has been revoked</h2>
            <p>This invite link is no longer active. Please ask a DinnerBears member for a new one.</p>
          </div>
        }

        @case ('invalid') {
          <div class="status-card error">
            <mat-icon class="status-icon">link_off</mat-icon>
            <h2>Invalid invite link</h2>
            <p>This invite link doesn't exist or is malformed.</p>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .join-page {
      max-width: 520px;
      margin: 0 auto;
      padding: 24px 16px 48px;
    }

    .brand-header {
      text-align: center;
      margin-bottom: 24px;
    }

    .brand-logo {
      height: 80px;
      width: auto;
    }

    .brand-tagline {
      margin: 8px 0 0;
      font-style: italic;
      color: var(--db-text-mid);
      font-size: 0.9rem;
    }

    .center {
      display: flex;
      justify-content: center;
      padding: 48px 0;
    }

    .join-card {
      background: #fff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
    }

    .event-photo {
      height: 200px;
      overflow: hidden;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
    }

    .card-body {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .join-label {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0;
      font-weight: 600;
      color: var(--db-primary);
      font-size: 0.95rem;

      .label-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .event-title {
      margin: 0;
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--db-brown-dark);
      line-height: 1.3;
    }

    .event-meta {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .meta-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 0.9rem;
      color: var(--db-text-mid);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        margin-top: 2px;
        color: var(--db-accent);
      }
    }

    .access-note {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 0;
      padding: 12px;
      background: #e3f2fd;
      border-radius: 8px;
      font-size: 0.85rem;
      color: #1565c0;

      .note-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        margin-top: 1px;
      }
    }

    .auth-buttons {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .auth-btn {
      width: 100%;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      font-size: 0.95rem;
      font-weight: 500;
    }

    .google-btn {
      background: #fff !important;
      color: #333 !important;
      border: 1px solid #dadce0 !important;
      box-shadow: 0 1px 3px rgba(0,0,0,.12) !important;
    }

    .fb-btn {
      background: #1877F2 !important;
      color: #fff !important;
      border: none !important;
    }

    .provider-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }

    .expires-note {
      margin: 0;
      font-size: 0.78rem;
      color: var(--db-text-light);
      text-align: center;
    }

    .status-card {
      text-align: center;
      padding: 48px 24px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);

      .status-icon {
        font-size: 56px;
        width: 56px;
        height: 56px;
        margin-bottom: 16px;
      }

      h2 {
        margin: 0 0 12px;
        font-size: 1.25rem;
        color: var(--db-brown-dark);
      }

      p {
        margin: 0;
        color: var(--db-text-mid);
        font-size: 0.9rem;
      }

      &.error .status-icon {
        color: #c62828;
      }
    }
  `],
})
export class JoinComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly invitesService = inject(InvitesService);
  private readonly authService = inject(AuthService);

  readonly state = signal<PageState>('loading');
  readonly preview = signal<InvitePreview | null>(null);
  readonly fbReady = signal(false);
  readonly fbLogging = signal(false);

  ngOnInit(): void {
    const code = this.route.snapshot.paramMap.get('code') ?? '';
    this.invitesService.previewInvite(code).subscribe({
      next: (p) => {
        this.preview.set(p);
        if (p.isRevoked) {
          this.state.set('revoked');
        } else if (p.isExpired) {
          this.state.set('expired');
        } else if (p.isFull) {
          this.state.set('full');
        } else {
          this.state.set('ready');
          if (environment.facebookAppId) {
            this.loadFbSdk(environment.facebookAppId);
          }
        }
      },
      error: () => this.state.set('invalid'),
    });
  }

  private loadFbSdk(appId: string): void {
    const win = window as Record<string, any>;
    const onReady = () => {
      if (!win['__fbDone']) {
        win['FB'].init({ appId, cookie: true, xfbml: true, version: 'v22.0' });
        win['__fbDone'] = true;
      }
      win['FB'].getLoginStatus(() => this.fbReady.set(true));
    };
    if (win['__fbDone']) { win['FB'].getLoginStatus(() => this.fbReady.set(true)); return; }
    if (win['FB']) { onReady(); return; }
    win['fbAsyncInit'] = onReady;
    if (!document.getElementById('facebook-jssdk')) {
      const js = document.createElement('script');
      js.id = 'facebook-jssdk';
      js.src = 'https://connect.facebook.net/en_US/sdk.js';
      document.head.appendChild(js);
    }
  }

  signInWithGoogle(): void {
    const token = this.preview()?.token;
    this.authService.loginWithGoogle(token);
  }

  signInWithFacebook(): void {
    const FB = (window as Record<string, any>)['FB'];
    if (!FB) return;
    this.fbLogging.set(true);
    FB.login((response: Record<string, any>) => {
      if (response['status'] === 'connected') {
        const accessToken = response['authResponse']['accessToken'] as string;
        const token = this.preview()?.token;
        this.authService.loginWithFacebook(accessToken, token).subscribe({
          error: (err) => {
            this.fbLogging.set(false);
            const reason = (err?.error?.reason as string) ?? 'fb_error';
            void this.router.navigate(['/auth/error'], { queryParams: { reason } });
          },
        });
      } else {
        this.fbLogging.set(false);
      }
    }, { scope: 'public_profile,email' });
  }

  formatTime(time: string): string {
    const [h, m] = time.split(':').map(Number);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 || 12;
    return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
  }
}
