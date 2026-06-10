import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

interface ErrorContent {
  icon: string;
  title: string;
  body: string;
  showInviteHint: boolean;
}

const ERROR_CONTENT: Record<string, ErrorContent> = {
  no_invite: {
    icon: 'mail_lock',
    title: 'Invite required',
    body: 'DinnerBears is invite-only. Ask a current member to send you an invite link, then try signing in again.',
    showInviteHint: true,
  },
  not_active: {
    icon: 'block',
    title: 'Account unavailable',
    body: 'Your account is not currently active. If you think this is a mistake, reach out to a DinnerBears admin.',
    showInviteHint: false,
  },
  invalid_invite: {
    icon: 'link_off',
    title: 'Invalid invite link',
    body: "That invite link doesn't look right. Make sure you're using the full link from your invitation email.",
    showInviteHint: false,
  },
  invite_used: {
    icon: 'check_circle',
    title: 'Invite already used',
    body: 'This invite link has already been claimed. Ask a member to send you a fresh invite.',
    showInviteHint: true,
  },
  invite_expired: {
    icon: 'timer_off',
    title: 'Invite expired',
    body: 'This invite link has expired. Ask a DinnerBears member to send you a new one.',
    showInviteHint: true,
  },
  invite_email_mismatch: {
    icon: 'person_off',
    title: 'Wrong Google account',
    body: "This invite was sent to a different email address. Try signing in with the Google account that matches your invitation, or ask for a new invite.",
    showInviteHint: false,
  },
};

const FALLBACK: ErrorContent = {
  icon: 'error_outline',
  title: 'Sign-in failed',
  body: "Something went wrong while signing you in. Please try again, or contact a DinnerBears admin if the problem continues.",
  showInviteHint: false,
};

@Component({
  selector: 'app-auth-error',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, RouterLink],
  template: `
    <div class="error-page">
      <div class="error-card">
        <div class="bear-logo">
          <img src="/images/dinnerbears-logo.png" alt="DinnerBears" />
        </div>

        <mat-icon class="error-icon">{{ content().icon }}</mat-icon>

        <h1 class="error-title">{{ content().title }}</h1>
        <p class="error-body">{{ content().body }}</p>

        @if (content().showInviteHint) {
          <p class="invite-hint">
            Don't have an invite? Have a current member visit
            <strong>dinnerbears.com</strong> to send you one.
          </p>
        }

        <div class="actions">
          <a mat-raised-button color="primary" routerLink="/login">Back to sign in</a>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .error-page {
      min-height: calc(100vh - 64px - 52px);
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--db-cream);
      padding: 24px 16px;
    }

    .error-card {
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 2px 16px rgba(0,0,0,.08);
      padding: 40px 32px;
      max-width: 420px;
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 16px;
    }

    .bear-logo img {
      height: 56px;
      filter: drop-shadow(0 2px 4px rgba(61,28,5,.15));
    }

    .error-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #c62828;
    }

    .error-title {
      margin: 0;
      font-size: 1.4rem;
      font-weight: 600;
      color: var(--db-text-dark);
    }

    .error-body {
      margin: 0;
      color: var(--db-text-mid);
      line-height: 1.5;
    }

    .invite-hint {
      margin: 0;
      font-size: 0.85rem;
      color: #888;
      background: var(--db-cream);
      border-radius: 6px;
      padding: 10px 14px;
      line-height: 1.5;
    }

    .actions {
      margin-top: 8px;
    }
  `],
})
export class AuthErrorComponent {
  private readonly route = inject(ActivatedRoute);

  readonly content = computed<ErrorContent>(() => {
    const reason = this.route.snapshot.queryParamMap.get('reason') ?? '';
    return ERROR_CONTENT[reason] ?? FALLBACK;
  });
}
