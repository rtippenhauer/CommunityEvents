import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-error-page',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, RouterLink],
  template: `
    <div class="error-bg">
      <div class="error-card">
        <mat-icon class="error-icon">{{ icon() }}</mat-icon>
        <h1 class="error-title">{{ title() }}</h1>
        <p class="error-body">{{ body() }}</p>

        @if (invitedEmail()) {
          <div class="invited-email-block">
            <span class="invited-label">Invite sent to:</span>
            <span class="invited-address">{{ invitedEmail() }}</span>
          </div>
        }

        @if (showInviteHint()) {
          <p class="invite-hint">
            Don't have an invite? Have a current member visit
            <strong>dinnerbears.com</strong> to send you one.
          </p>
        }

        <div class="actions">
          @if (showLoginButton()) {
            <a mat-raised-button color="primary" routerLink="/login">Back to sign in</a>
          }
          @if (showHomeButton()) {
            <a mat-raised-button color="primary" routerLink="/">Go home</a>
          }
        </div>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .error-bg {
        min-height: 100vh;
        background: url('/images/ErrorMenuBoard.png') center top / cover no-repeat;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: clamp(140px, 30vw, 440px) 16px 60px;
      }

      .error-card {
        background: transparent;
        padding: 0 28px;
        max-width: 360px;
        width: 100%;
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 14px;
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
        font-weight: 700;
        color: #3d1c05;
      }

      .error-body {
        margin: 0;
        color: #555;
        line-height: 1.55;
        font-size: 0.95rem;
      }

      .invited-email-block {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        background: #fff3e0;
        border: 1px solid #ffe0b2;
        border-radius: 8px;
        padding: 10px 20px;
        width: 100%;
      }

      .invited-label {
        font-size: 0.72rem;
        color: #888;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .invited-address {
        font-weight: 600;
        color: #3d1c05;
        word-break: break-all;
      }

      .invite-hint {
        margin: 0;
        font-size: 0.83rem;
        color: #888;
        background: var(--db-cream);
        border-radius: 6px;
        padding: 10px 14px;
        line-height: 1.5;
      }

      .actions {
        margin-top: 4px;
      }
    `,
  ],
})
export class ErrorPageComponent {
  readonly icon = input('error_outline');
  readonly title = input('Something went wrong');
  readonly body = input(
    'Please try again, or contact an admin if the problem continues.',
  );
  readonly showLoginButton = input(false);
  readonly showHomeButton = input(false);
  readonly showInviteHint = input(false);
  readonly invitedEmail = input<string | null>(null);
}
