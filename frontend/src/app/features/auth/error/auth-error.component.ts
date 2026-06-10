import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ErrorPageComponent } from '../../../shared/components/error-page/error-page.component';

interface ErrorContent {
  icon: string;
  title: string;
  body: string;
  showInviteHint: boolean;
}

const ERROR_CONTENT: Record<string, ErrorContent> = {
  no_invite: {
    icon: 'mail_lock',
    title: 'Account not found',
    body: "We couldn't find a DinnerBears account linked to your Google sign-in. DinnerBears is invite-only — if you've received an invite link, use it to sign up.",
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
    body: "The Google account you signed in with doesn't match the email this invite was sent to. Try again with the correct Google account.",
    showInviteHint: false,
  },
};

const FALLBACK: ErrorContent = {
  icon: 'error_outline',
  title: 'Sign-in failed',
  body: 'Something went wrong while signing you in. Please try again, or contact a DinnerBears admin if the problem continues.',
  showInviteHint: false,
};

@Component({
  selector: 'app-auth-error',
  standalone: true,
  imports: [ErrorPageComponent],
  template: `
    <app-error-page
      [icon]="content().icon"
      [title]="content().title"
      [body]="content().body"
      [showInviteHint]="content().showInviteHint"
      [invitedEmail]="invitedEmail()"
      [showLoginButton]="true"
    />
  `,
})
export class AuthErrorComponent {
  private readonly route = inject(ActivatedRoute);

  readonly content = computed<ErrorContent>(() => {
    const reason = this.route.snapshot.queryParamMap.get('reason') ?? '';
    return ERROR_CONTENT[reason] ?? FALLBACK;
  });

  readonly invitedEmail = computed<string | null>(
    () => this.route.snapshot.queryParamMap.get('email'),
  );
}
