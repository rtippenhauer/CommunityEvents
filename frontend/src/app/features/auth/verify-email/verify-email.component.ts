import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <div class="page">
      @if (loading()) {
        <mat-spinner diameter="48" />
        <p>Verifying your email...</p>
      } @else if (success()) {
        <mat-icon class="icon success">check_circle</mat-icon>
        <h1>Email verified!</h1>
        <p>Your account is now active. You can sign in.</p>
        <a routerLink="/login" mat-raised-button color="primary">Sign in</a>
      } @else {
        <mat-icon class="icon error">error_outline</mat-icon>
        <h1>Verification failed</h1>
        <p>{{ errorMessage() }}</p>
        <a routerLink="/login" mat-button>Back to sign in</a>
      }
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
      }
      .success {
        color: #2e7d32;
      }
      .error {
        color: #c62828;
      }
      h1 {
        margin: 0;
        font-size: 1.6rem;
        color: var(--db-brown-dark);
      }
      p {
        margin: 0;
        color: var(--db-text-mid);
      }
    `,
  ],
})
export class VerifyEmailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);

  readonly loading = signal(true);
  readonly success = signal(false);
  readonly errorMessage = signal('');

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!token) {
      this.loading.set(false);
      this.errorMessage.set('No verification token found.');
      return;
    }

    this.authService.verifyEmail(token).subscribe({
      next: () => {
        this.loading.set(false);
        this.success.set(true);
      },
      error: (err) => {
        this.loading.set(false);
        const reason = err?.error?.message ?? '';
        if (reason === 'token_expired') {
          this.errorMessage.set(
            'This link has expired. Request a new verification email from the sign-in page.',
          );
        } else {
          this.errorMessage.set('This link is invalid or has already been used.');
        }
      },
    });
  }
}
