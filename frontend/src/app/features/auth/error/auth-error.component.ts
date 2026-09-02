import { Component, computed, inject, ChangeDetectionStrategy } from '@angular/core';
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
    body: "We couldn't find an account linked to your sign-in. This community is invite-only — if you've received an invite link, use it to sign up.",
    showInviteHint: true,
  },
  not_active: {
    icon: 'block',
    title: 'Account unavailable',
    body: 'Your account is not currently active. If you think this is a mistake, reach out to an admin.',
    showInviteHint: false,
  },
  invalid_invite: {
    icon: 'link_off',
    title: 'Invalid invite link',
    body: "That invite link doesn't look right. Make sure you're using the full link from your invitation.",
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
    body: 'This invite link has expired. Ask a member to send you a new one.',
    showInviteHint: true,
  },
  invite_email_mismatch: {
    icon: 'person_off',
    title: 'Wrong account',
    body: "The account you signed in with doesn't match the email this invite was sent to. Try again with the account your invite was sent to.",
    showInviteHint: false,
  },
  // v2-8 reasons. Each one is a state the sign-in genuinely reached, and each
  // says what to do next -- the fallback below says "try again", which is wrong
  // advice for three of these four.
  provider_not_offered: {
    icon: 'no_accounts',
    title: 'That sign-in method is not available here',
    body: 'This community does not offer that way of signing in. Use your email address and password instead.',
    showInviteHint: false,
  },
  consent_denied: {
    icon: 'do_not_disturb_on',
    title: 'Sign-in cancelled',
    body: 'You cancelled before granting access, so nothing was shared and you are not signed in. You can try again whenever you like.',
    showInviteHint: false,
  },
  invalid_state: {
    icon: 'gpp_maybe',
    title: 'Sign-in could not be verified',
    body: 'We could not confirm that this sign-in started here, so it was stopped. This usually means it took too long or the link was tampered with. Please start again from the login page.',
    showInviteHint: false,
  },
  exchange_failed: {
    icon: 'cloud_off',
    title: 'Sign-in failed',
    body: 'Something went wrong while confirming your account with the provider. Please try again.',
    showInviteHint: false,
  },
  no_email: {
    icon: 'alternate_email',
    title: 'No email address shared',
    body: 'Your account did not share an email address, and one is needed to identify you here. Sign in with your email address and password instead.',
    showInviteHint: false,
  },
  handoff_invalid: {
    icon: 'timer_off',
    title: 'That sign-in link has already been used',
    body: 'Sign-ins are completed once and cannot be repeated -- refreshing this page is the usual way to see this. Please sign in again.',
    showInviteHint: false,
  },
  fb_error: {
    icon: 'cloud_off',
    title: 'Facebook sign-in failed',
    body: 'Something went wrong verifying your Facebook account. Please try again, or use Google to sign in instead.',
    showInviteHint: false,
  },
  // Both providers reach this now. It used to be Facebook's alone, because
  // Google quietly re-linked on a matching address instead of refusing -- so the
  // copy named Facebook and told people to use Google, advice that is wrong half
  // the time now that either can be the one that is not connected.
  provider_not_linked: {
    icon: 'link_off',
    title: 'That account is not connected yet',
    body: 'An account already exists with this email address, but that sign-in method is not connected to it. Sign in the way you normally do, then connect it from Account Settings.',
    showInviteHint: false,
  },
};

const FALLBACK: ErrorContent = {
  icon: 'error_outline',
  title: 'Sign-in failed',
  body: 'Something went wrong while signing you in. Please try again, or contact an admin if the problem continues.',
  showInviteHint: false,
};

@Component({
  selector: 'app-auth-error',
  standalone: true,
  imports: [ErrorPageComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
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

  readonly invitedEmail = computed<string | null>(() =>
    this.route.snapshot.queryParamMap.get('email'),
  );
}
