import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * How far this community's mail-chain self-test has got (v2-48). Mirrors
 * `email_provider_config_selftest_state` on the API side.
 *
 * `delivered` is an **optional waypoint, not a step**: only Brevo reports
 * deliverability, so a test can go straight from `sent` to `passed`. A screen
 * that renders these as a strict four-stage progress bar would show a test that
 * worked as though it had skipped a stage.
 */
export type MailSelfTestState = 'never_run' | 'sent' | 'delivered' | 'passed' | 'failed';

/**
 * The self-test fields of `GET /admin/email/config`, which is also what the
 * send endpoint answers with.
 *
 * The nonce is deliberately absent: it is not a credential, and the server does
 * not send it — the screen renders the state, not the identifier.
 */
export interface MailSelfTestStatus {
  selftestState: MailSelfTestState;
  /** The address the invite went to: always the admin who pressed the button. */
  selftestEmail: string | null;
  selftestSentAt: string | null;
  selftestDeliveredAt: string | null;
  selftestPassedAt: string | null;
  selftestLastReplyAt: string | null;
  /** `going` / `maybe` / `not_going`, from the latest reply's PARTSTAT. */
  selftestLastReplyStatus: string | null;
  /** 2 or more means the operator accepted and then declined, which is allowed. */
  selftestReplyCount: number;
  selftestError: string | null;
}

/**
 * Proving a community's mail and calendar chain without mailing a member
 * (v2-48).
 *
 * **There is no address parameter, here or on the server.** The invite goes to
 * the acting admin, taken from the session: a call that accepted an address and
 * sent a real calendar invite to it would be a send tool, and this is a
 * diagnostic. Adding one here would be adding one to the product.
 */
@Injectable({ providedIn: 'root' })
export class MailSelfTestService {
  private readonly http = inject(HttpClient);

  /**
   * Sends the invite and answers with the config as it now stands.
   *
   * A 400 is the expected shape of a *useful* failure — a suppressed operator
   * address, or a provider that refused the key — and its message is written to
   * be shown to whoever pressed the button.
   */
  send(): Observable<MailSelfTestStatus> {
    return this.http.post<MailSelfTestStatus>('/api/v1/admin/email/selftest', {});
  }
}
