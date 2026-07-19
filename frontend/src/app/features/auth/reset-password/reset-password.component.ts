import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="page">
      @if (!success()) {
        <mat-icon class="icon">lock_reset</mat-icon>
        <h1>Set new password</h1>

        @if (tokenMissing()) {
          <p class="error">This reset link is invalid or has already been used.</p>
          <a routerLink="/auth/forgot-password" mat-raised-button color="primary"
            >Request a new link</a
          >
        } @else {
          <form [formGroup]="form" (ngSubmit)="submit()" class="form">
            <mat-form-field appearance="outline" class="full-width">
              <mat-label>New password</mat-label>
              <input
                matInput
                formControlName="password"
                [type]="showPassword() ? 'text' : 'password'"
                autocomplete="new-password"
              />
              <button
                mat-icon-button
                matSuffix
                type="button"
                (click)="showPassword.set(!showPassword())"
              >
                <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              <mat-hint>At least 8 characters</mat-hint>
            </mat-form-field>

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Confirm new password</mat-label>
              <input
                matInput
                formControlName="confirmPassword"
                [type]="showPassword() ? 'text' : 'password'"
                autocomplete="new-password"
              />
            </mat-form-field>

            @if (formError()) {
              <p class="error">{{ formError() }}</p>
            }

            <button
              mat-raised-button
              color="primary"
              type="submit"
              class="full-width"
              [disabled]="form.invalid || submitting()"
            >
              @if (submitting()) {
                <mat-spinner diameter="20" />
              } @else {
                Update password
              }
            </button>
          </form>
        }
      } @else {
        <mat-icon class="icon success-icon">check_circle</mat-icon>
        <h1>Password updated</h1>
        <p>You can now sign in with your new password.</p>
        <a routerLink="/login" mat-raised-button color="primary">Sign in</a>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styles: [
    `
      .page {
        max-width: 420px;
        margin: 80px auto;
        text-align: center;
        padding: 0 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
      }
      .icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        color: var(--db-primary);
      }
      .success-icon {
        color: #2e7d32;
      }
      h1 {
        margin: 0;
        font-size: 1.5rem;
        color: var(--db-brown-dark);
      }
      p {
        margin: 0;
        color: var(--db-text-mid);
      }
      .error {
        color: #c62828;
        font-size: 0.85rem;
      }
      .form {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 8px;
        text-align: left;
      }
      .full-width {
        width: 100%;
      }
    `,
  ],
})
export class ResetPasswordComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly showPassword = signal(false);
  readonly submitting = signal(false);
  readonly success = signal(false);
  readonly tokenMissing = signal(false);
  readonly formError = signal<string | null>(null);

  private token = '';

  readonly form = this.fb.group({
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  });

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') ?? '';
    if (!this.token) this.tokenMissing.set(true);
  }

  submit(): void {
    this.formError.set(null);
    const { password, confirmPassword } = this.form.getRawValue();
    if (password !== confirmPassword) {
      this.formError.set('Passwords do not match.');
      return;
    }

    this.submitting.set(true);
    this.authService.resetPassword(this.token, password).subscribe({
      next: () => {
        this.submitting.set(false);
        this.success.set(true);
      },
      error: (err) => {
        this.submitting.set(false);
        const reason = err?.error?.message ?? '';
        if (reason === 'token_expired' || reason === 'invalid_token') {
          this.tokenMissing.set(true);
        } else {
          this.formError.set('Something went wrong. Please try again.');
        }
      },
    });
  }
}
