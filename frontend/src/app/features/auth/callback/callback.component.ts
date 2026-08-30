import { Component, effect, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Where an OAuth sign-in lands, on the community's own host.
 *
 * The provider's callback cannot finish the job: it terminates on this
 * deployment's one registered host (REQ-TENANT-01.8), and the session cookie is
 * host-only (REQ-TENANT-01.7), so a cookie set there would never reach this
 * community. It hands over a single-use ticket in the query string instead, and
 * redeeming it here is what actually creates the session.
 *
 * The ticket is stripped from the URL before anything else happens. It is spent
 * by then, but a credential-shaped value should not sit in the address bar, in
 * history, or in the `Referer` of whatever the next page loads.
 */
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
  changeDetection: ChangeDetectionStrategy.Eager,
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
  private readonly route = inject(ActivatedRoute);

  /** Held until the ticket is redeemed, so the effect below does not act early. */
  private readonly settling = signal(true);

  constructor() {
    const handoff = this.route.snapshot.queryParamMap.get('handoff');

    if (handoff) {
      history.replaceState(null, '', window.location.pathname);
      this.authService.redeemHandoff(handoff).subscribe({
        next: () => this.settling.set(false),
        // The ticket was already spent or has expired -- a refresh of this page
        // is the ordinary way to get here. `/auth/error` explains it; falling
        // through to `/login` would just look like the sign-in silently failed.
        error: () => void this.router.navigate(['/auth/error'], {
          queryParams: { reason: 'handoff_invalid' },
        }),
      });
    } else {
      this.settling.set(false);
    }

    effect(() => {
      if (this.settling() || this.authService.isLoading()) return;
      void this.router.navigate([this.authService.isLoggedIn() ? '/profile' : '/login']);
    });
  }
}
