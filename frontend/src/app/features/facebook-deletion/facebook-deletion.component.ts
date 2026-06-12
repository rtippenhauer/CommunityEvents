import { Component } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-facebook-deletion',
  standalone: true,
  imports: [MatIconModule],
  template: `
    <div class="deletion-page">
      <mat-icon class="check-icon">check_circle</mat-icon>
      <h1>Facebook Data Deletion</h1>
      <p class="lead">Your request has been received and processed.</p>
      <p>All Facebook login data associated with your DinnerBears account has been removed from our systems. You can no longer sign in via Facebook, but your DinnerBears account and all your event history remain intact.</p>
      @if (code) {
        <div class="code-box">
          <span class="code-label">Confirmation Code</span>
          <span class="code-value">{{ code }}</span>
        </div>
      }
      <p class="contact">Questions? Email us at <a href="mailto:hello&#64;dinnerbears.com">hello&#64;dinnerbears.com</a></p>
    </div>
  `,
  styles: [`
    .deletion-page {
      max-width: 560px;
      margin: 80px auto;
      padding: 0 24px;
      text-align: center;
    }
    .check-icon { font-size: 3.5rem; width: 3.5rem; height: 3.5rem; color: #2e7d32; margin-bottom: 16px; }
    h1 { font-size: 1.75rem; color: var(--db-brown-dark); margin: 0 0 12px; }
    .lead { font-size: 1.05rem; color: #444; margin: 0 0 16px; }
    p { font-size: 0.95rem; color: #555; line-height: 1.6; margin: 0 0 20px; }
    .code-box {
      display: inline-flex; flex-direction: column; align-items: center;
      background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 8px;
      padding: 12px 28px; margin: 4px 0 24px;
    }
    .code-label { font-size: 0.75rem; color: #888; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px; }
    .code-value { font-size: 1.2rem; font-weight: 700; font-family: monospace; color: #333; letter-spacing: 0.12em; }
    .contact a { color: var(--db-blue, #1E4D8C); }
  `],
})
export class FacebookDeletionComponent {
  readonly code: string | null;

  constructor(route: ActivatedRoute) {
    this.code = route.snapshot.queryParamMap.get('code');
  }
}
