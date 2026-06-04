import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [MatButtonModule, MatCardModule, MatIconModule],
  template: `
    <div class="login-container">
      <mat-card class="login-card">
        <mat-card-header>
          <mat-card-title>Welcome to DinnerBears</mat-card-title>
          <mat-card-subtitle>Sign in to join the table</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
          @if (inviteToken()) {
            <p class="invite-notice">You have an invite — sign in to claim it.</p>
          }
        </mat-card-content>
        <mat-card-actions>
          <button mat-raised-button color="primary" (click)="signInWithGoogle()">
            <mat-icon>login</mat-icon>
            Continue with Google
          </button>
        </mat-card-actions>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .login-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 60vh;
      }
      .login-card {
        max-width: 400px;
        width: 100%;
        padding: 16px;
      }
      .invite-notice {
        color: var(--mat-primary-color);
        font-size: 0.875rem;
        margin: 8px 0;
      }
      mat-card-actions {
        display: flex;
        justify-content: center;
        padding: 16px;
      }
      button mat-icon {
        margin-right: 8px;
      }
    `,
  ],
})
export class LoginComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);

  readonly inviteToken = signal<string | null>(null);

  ngOnInit(): void {
    const token = this.route.snapshot.queryParamMap.get('token');
    this.inviteToken.set(token);
  }

  signInWithGoogle(): void {
    this.authService.loginWithGoogle(this.inviteToken() ?? undefined);
  }
}
