import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TenantState } from '../../core/services/tenant-status.service';

/**
 * Shown instead of the whole app when the API reports that this host has no
 * usable tenant (REQ-TENANT-01.2).
 *
 * Deliberately self-contained: no BrandConfigService, no Material, no shared
 * error-page component. Branding is per-tenant runtime config, and on an
 * unrecognized host there is no tenant to have branding — anything that reads
 * it would render a half-applied theme belonging to nobody. The styles are
 * inline for the same reason, so this page cannot be broken by a change to a
 * theme it does not participate in.
 *
 * This is the holding page, not the marketing one. The real root-tenant
 * landing page is a separate, later item (v2-8) and will replace what this
 * says, not how it is triggered.
 */
@Component({
  selector: 'app-tenant-unavailable',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <main class="tenant-unavailable">
      <div class="card">
        <h1>Welcome to Community Events</h1>
        <p class="lead">{{ headline() }}</p>
        <p class="detail">{{ detail() }}</p>
      </div>
    </main>
  `,
  styles: `
    .tenant-unavailable {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1.5rem;
      background: #f7f3ec;
      color: #2c2c2c;
      font-family:
        system-ui,
        -apple-system,
        'Segoe UI',
        sans-serif;
    }

    .card {
      max-width: 32rem;
      text-align: center;
    }

    h1 {
      margin: 0 0 1rem;
      font-size: clamp(1.5rem, 5vw, 2.25rem);
      font-weight: 700;
      line-height: 1.2;
    }

    .lead {
      margin: 0 0 0.75rem;
      font-size: 1.125rem;
      line-height: 1.5;
    }

    .detail {
      margin: 0;
      color: #6b6b6b;
      line-height: 1.6;
    }
  `,
})
export class TenantUnavailableComponent {
  readonly state = input.required<TenantState>();

  readonly headline = computed(() => {
    switch (this.state()) {
      case 'suspended':
        return 'This community is temporarily unavailable.';
      case 'not-configured':
        return 'This site is still being set up.';
      default:
        return "There's no community at this address yet.";
    }
  });

  readonly detail = computed(() => {
    switch (this.state()) {
      case 'suspended':
        return 'It has been paused by an administrator. Please check back later.';
      case 'not-configured':
        return 'Setup has not finished on this deployment. If you administer it, check the server logs for details.';
      default:
        return 'If you were expecting a community here, double-check the web address you used.';
    }
  });
}
