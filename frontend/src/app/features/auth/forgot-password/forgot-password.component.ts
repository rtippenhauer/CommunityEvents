import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-forgot-password',
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
      @if (!submitted()) {
        <mat-icon class="icon">lock_reset</mat-icon>
        <h1>Reset your password</h1>
        <p>Enter your email address and we'll send you a reset link.</p>

        <form [formGroup]="form" (ngSubmit)="submit()" class="form">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Email</mat-label>
            <input matInput formControlName="email" type="email" autocomplete="email" />
          </mat-form-field>

          <button mat-raised-button color="primary" type="submit" class="full-width"
            [disabled]="form.invalid || submitting()">
            @if (submitting()) { <mat-spinner diameter="20" /> }
            @else { Send reset link }
          </button>
        </form>

        <a routerLink="/login" mat-button>Back to sign in</a>
      } @else {
        <mat-icon class="icon">mark_email_read</mat-icon>
        <h1>Check your email</h1>
        <p>If that address is registered, a reset link is on its way. It expires in 1 hour.</p>
        <a routerLink="/login" mat-raised-button color="primary">Back to sign in</a>
      }
    </div>
  `,
  styles: [`
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
    .icon { font-size: 48px; width: 48px; height: 48px; color: var(--db-primary); }
    h1 { margin: 0; font-size: 1.5rem; color: var(--db-brown-dark); }
    p { margin: 0; color: var(--db-text-mid); line-height: 1.6; }
    .form { width: 100%; display: flex; flex-direction: column; gap: 8px; text-align: left; }
    .full-width { width: 100%; }
  `],
})
export class ForgotPasswordComponent {
  private readonly authService = inject(AuthService);
  private readonly fb = inject(NonNullableFormBuilder);

  readonly submitting = signal(false);
  readonly submitted = signal(false);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  submit(): void {
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.authService.forgotPassword(this.form.getRawValue().email).subscribe({
      next: () => { this.submitting.set(false); this.submitted.set(true); },
      error: () => { this.submitting.set(false); this.submitted.set(true); }, // always show success
    });
  }
}
