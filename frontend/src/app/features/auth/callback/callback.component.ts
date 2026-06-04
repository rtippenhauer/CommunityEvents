import { Component, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [MatProgressSpinnerModule],
  template: `
    <div class="callback-container">
      <mat-spinner diameter="48" />
      <p>Signing you in…</p>
    </div>
  `,
  styles: [
    `
      .callback-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 60vh;
        gap: 16px;
      }
    `,
  ],
})
export class CallbackComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      if (!this.authService.isLoading()) {
        this.router.navigate([this.authService.isLoggedIn() ? '/' : '/login']);
      }
    });
  }
}
