import { Injectable, computed, signal } from '@angular/core';

/**
 * Which tenant this browser reached, as reported by the API (REQ-TENANT-01.2).
 *
 * `ok` is the assumed state: the app renders normally until something proves
 * otherwise, so a slow or failed network call never blanks the site.
 */
export type TenantState = 'ok' | 'not-found' | 'not-configured' | 'suspended';

// The `reason` values TenantMiddleware puts in its error bodies. Anything else
// is an ordinary API error and must not take the whole app down.
const REASONS: Record<string, TenantState> = {
  TENANT_NOT_FOUND: 'not-found',
  TENANT_NOT_CONFIGURED: 'not-configured',
  TENANT_SUSPENDED: 'suspended',
};

@Injectable({ providedIn: 'root' })
export class TenantStatusService {
  readonly state = signal<TenantState>('ok');
  readonly unavailable = computed(() => this.state() !== 'ok');

  /**
   * Called by tenantInterceptor for every failed API response. Takes the
   * parsed error body rather than the HttpErrorResponse so it stays trivial
   * to test and has no HTTP dependency.
   */
  record(body: unknown): void {
    const reason = (body as { reason?: unknown } | null)?.reason;
    if (typeof reason !== 'string') return;

    const state = REASONS[reason];
    // Once unavailable, stay unavailable. Later requests on a dead tenant fail
    // in assorted ways, and letting an unrelated error clear the placeholder
    // would flip the user back to a broken shell.
    if (state) this.state.set(state);
  }
}
