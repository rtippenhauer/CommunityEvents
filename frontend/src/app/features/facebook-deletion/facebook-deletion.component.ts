import { Component, OnInit, signal, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AccountService, DeletionStatus } from '../../core/services/account.service';

@Component({
  selector: 'app-account-deletion-status',
  standalone: true,
  imports: [MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="status-page">
      @if (loading()) {
        <mat-spinner diameter="40"></mat-spinner>
      } @else if (statusCode() === 'completed') {
        <mat-icon class="status-icon done">check_circle</mat-icon>
        <h1>Data Deleted</h1>
        <p class="lead">Your Facebook data has been deleted from DinnerBears.</p>
        @if (code()) {
          <div class="code-box">
            <span class="code-label">Confirmation Code</span>
            <span class="code-value">{{ code() }}</span>
          </div>
        }
      } @else if (statusCode() === 'pending') {
        <mat-icon class="status-icon pending">hourglass_top</mat-icon>
        <h1>Deletion Request Received</h1>
        <p class="lead">Your data deletion request has been received and is being processed.</p>
        <p>Your Facebook data will be permanently deleted within 30 days.</p>
        @if (code()) {
          <div class="code-box">
            <span class="code-label">Confirmation Code</span>
            <span class="code-value">{{ code() }}</span>
          </div>
        }
      } @else if (statusCode() === 'not_found') {
        <mat-icon class="status-icon error">error_outline</mat-icon>
        <h1>Code Not Found</h1>
        <p>The confirmation code provided is invalid or has expired.</p>
      } @else {
        <!-- No code provided — general info page -->
        <mat-icon class="status-icon done">check_circle</mat-icon>
        <h1>Facebook Data Deletion</h1>
        <p class="lead">Your request has been received and processed.</p>
        <p>All Facebook login data associated with your DinnerBears account has been removed from our systems.</p>
      }

      <p class="contact">
        Questions? Email us at <a href="mailto:support&#64;dinnerbears.com">support&#64;dinnerbears.com</a>
      </p>
    </div>
  `,
  styles: [`
    .status-page {
      max-width: 560px;
      margin: 80px auto;
      padding: 0 24px;
      text-align: center;
    }

    .status-icon {
      font-size: 3.5rem;
      width: 3.5rem;
      height: 3.5rem;
      margin-bottom: 16px;
    }

    .status-icon.done { color: #2e7d32; }
    .status-icon.pending { color: #e65100; }
    .status-icon.error { color: #c62828; }

    h1 { font-size: 1.75rem; color: var(--db-brown-dark); margin: 0 0 12px; }
    .lead { font-size: 1.05rem; color: #444; margin: 0 0 16px; }
    p { font-size: 0.95rem; color: #555; line-height: 1.6; margin: 0 0 20px; }

    .code-box {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      background: #f5f5f5;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 12px 28px;
      margin: 4px 0 24px;
    }

    .code-label {
      font-size: 0.75rem;
      color: #888;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 4px;
    }

    .code-value {
      font-size: 1.2rem;
      font-weight: 700;
      font-family: monospace;
      color: #333;
      letter-spacing: 0.12em;
    }

    .contact a { color: var(--db-blue, #1E4D8C); }
  `],
})
export class FacebookDeletionComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly accountService = inject(AccountService);

  readonly code = signal<string | null>(null);
  readonly statusCode = signal<DeletionStatus | null>(null);
  readonly loading = signal(false);

  ngOnInit(): void {
    const codeParam = this.route.snapshot.queryParamMap.get('code');
    this.code.set(codeParam);

    if (codeParam) {
      this.loading.set(true);
      this.accountService.getDeletionStatus(codeParam).subscribe({
        next: (res) => { this.statusCode.set(res.status); this.loading.set(false); },
        error: () => { this.statusCode.set('not_found'); this.loading.set(false); },
      });
    }
  }
}
