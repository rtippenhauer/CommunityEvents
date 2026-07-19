import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-verify-email-sent',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatSnackBarModule],
  template: `
    <div class="page">
      <mat-icon class="icon">mark_email_unread</mat-icon>
      <h1>Check your email</h1>
      <p>
        We sent a verification link to <strong>{{ email() }}</strong
        >. Click the link to activate your account.
      </p>
      <p class="sub">The link expires in 48 hours. Check your spam folder if you don't see it.</p>

      @if (email()) {
        <button mat-button (click)="resend()" [disabled]="sent()">
          {{ sent() ? 'Sent!' : 'Resend verification email' }}
        </button>
      }

      <a routerLink="/login" mat-button>Back to sign in</a>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .page {
        max-width: 480px;
        margin: 80px auto;
        text-align: center;
        padding: 0 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }
      .icon {
        font-size: 56px;
        width: 56px;
        height: 56px;
        color: var(--db-primary);
      }
      h1 {
        margin: 0;
        font-size: 1.6rem;
        color: var(--db-brown-dark);
      }
      p {
        margin: 0;
        color: var(--db-text-mid);
        line-height: 1.6;
      }
      .sub {
        font-size: 0.85rem;
        color: #999;
      }
    `,
  ],
})
export class VerifyEmailSentComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);
  private readonly snackBar = inject(MatSnackBar);

  readonly email = signal('');
  readonly sent = signal(false);

  ngOnInit(): void {
    this.email.set(this.route.snapshot.queryParamMap.get('email') ?? '');
  }

  resend(): void {
    const email = this.email();
    if (!email) return;
    this.authService.resendVerification(email).subscribe({
      next: () => {
        this.sent.set(true);
        this.snackBar.open('Verification email resent.', 'OK', { duration: 4000 });
      },
      error: () =>
        this.snackBar.open('Failed to resend. Please try again.', 'OK', { duration: 4000 }),
    });
  }
}
