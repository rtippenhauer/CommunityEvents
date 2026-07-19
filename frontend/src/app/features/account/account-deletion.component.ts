import { Component, ChangeDetectionStrategy } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-account-deletion',
  standalone: true,
  imports: [MatIconModule, MatDividerModule, RouterLink],
  template: `
    <div class="deletion-page">
      <h1>DinnerBears — Account &amp; Data Deletion</h1>

      <section>
        <h2>Remove Facebook Login (keep your account)</h2>
        <p>
          If you have another login method (Google or password) you can disconnect Facebook without
          deleting your account:
        </p>
        <ol>
          <li>Log into DinnerBears.</li>
          <li>
            Go to
            <a routerLink="/account/settings"
              ><strong>Account Settings → Connected Accounts</strong></a
            >.
          </li>
          <li>Click <strong>Disconnect</strong> next to Facebook.</li>
          <li>Confirm the disconnection.</li>
        </ol>
        <p>
          Your Facebook User ID and access tokens are immediately removed from DinnerBears systems.
        </p>
      </section>

      <mat-divider></mat-divider>

      <section>
        <h2>Delete your DinnerBears account</h2>
        <ol>
          <li>Log into DinnerBears.</li>
          <li>
            Go to
            <a routerLink="/account/settings"><strong>Account Settings → Danger Zone</strong></a
            >.
          </li>
          <li>Click <strong>Delete My Account</strong>.</li>
          <li>Complete the two-step confirmation.</li>
        </ol>
        <p>
          Your account is immediately deactivated. All Facebook and Google login data is removed
          immediately. Your name and email are permanently deleted within 30 days. Anonymous event
          attendance records may be retained.
        </p>
      </section>

      <mat-divider></mat-divider>

      <section>
        <h2>No account access?</h2>
        <p>
          Email <a href="mailto:support@dinnerbears.com">support&#64;dinnerbears.com</a> from the
          address associated with your account. Include your name and the email address you
          registered with.
        </p>
      </section>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .deletion-page {
        max-width: 680px;
        margin: 48px auto;
        padding: 0 24px 80px;
      }

      h1 {
        font-size: 1.6rem;
        color: var(--db-brown-dark, #3d2b1f);
        margin: 0 0 32px;
      }

      h2 {
        font-size: 1.15rem;
        color: #333;
        margin: 0 0 10px;
      }

      section {
        padding: 24px 0;
      }

      p,
      ol,
      li {
        font-size: 0.95rem;
        color: #444;
        line-height: 1.65;
      }

      ol {
        padding-left: 20px;
        margin: 8px 0 12px;
      }

      li {
        margin-bottom: 6px;
      }

      a {
        color: var(--db-blue, #1e4d8c);
        text-decoration: none;
      }

      a:hover {
        text-decoration: underline;
      }

      mat-divider {
        margin: 0;
      }
    `,
  ],
})
export class AccountDeletionComponent {}
