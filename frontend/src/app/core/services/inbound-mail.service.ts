import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * What became of an inbound message (v2-34).
 *
 * Mirrors `inbound_emails_outcome`. Thirteen values because there are thirteen
 * places the inbound path can stop, every one of which used to be a log line
 * and a silent return.
 */
export type InboundOutcome =
  | 'recorded'
  | 'unchanged'
  | 'invalid_secret'
  | 'malformed_request'
  | 'no_ical'
  | 'not_a_reply'
  | 'unknown_uid'
  | 'unparseable_attendee'
  | 'unhandled_partstat'
  | 'event_not_found'
  | 'tenant_mismatch'
  | 'member_not_found'
  | 'rate_limited'
  | 'counter_proposal';

export interface InboundMailRow {
  id: number;
  /** Null means the message matched no community. Only the operator sees these. */
  tenantId: number | null;
  /** The community's slug, served to the operator only. */
  tenantName: string | null;
  outcome: InboundOutcome;
  detail: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  subject: string | null;
  eventId: number | null;
  userId: number | null;
  rsvpStatus: string | null;
  sizeBytes: number;
  /** Served to the operator only: it describes whoever is talking to the deployment. */
  sourceIp: string | null;
  /** Further identical failures from this source, folded into this row. */
  suppressedCount: number;
  receivedAt: string;
}

export interface InboundMailPage {
  rows: InboundMailRow[];
  total: number;
  page: number;
  limit: number;
  byOutcome: Partial<Record<InboundOutcome, number>>;
}

export interface InboundMailQuery {
  q?: string;
  outcome?: string;
  failuresOnly?: boolean;
  unresolvedOnly?: boolean;
  page?: number;
  limit?: number;
}

/**
 * The two reads of the inbound log, kept as two methods.
 *
 * Deliberately not one method with an `operator` flag: the endpoints differ in
 * *what they are allowed to return*, not in a parameter. `forCommunity` can
 * never return a row belonging to another community or to none; `forOperator`
 * returns every row including the tenantless ones, which is the point of it.
 * Two methods make a component's choice visible at the call site.
 */
@Injectable({ providedIn: 'root' })
export class InboundMailService {
  private readonly http = inject(HttpClient);

  forCommunity(query: InboundMailQuery): Observable<InboundMailPage> {
    return this.http.get<InboundMailPage>('/api/v1/admin/email/inbound', {
      params: this.params(query),
    });
  }

  forOperator(query: InboundMailQuery): Observable<InboundMailPage> {
    return this.http.get<InboundMailPage>('/api/v1/system/email/inbound', {
      params: this.params(query),
    });
  }

  bodyForCommunity(id: number): Observable<{ raw: string | null }> {
    return this.http.get<{ raw: string | null }>(`/api/v1/admin/email/inbound/${id}`);
  }

  bodyForOperator(id: number): Observable<{ raw: string | null }> {
    return this.http.get<{ raw: string | null }>(`/api/v1/system/email/inbound/${id}`);
  }

  private params(query: InboundMailQuery): Record<string, string> {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(query)) {
      // Omitted rather than sent empty: the API validates `outcome` against a
      // known set, so `?outcome=` would be a 400 rather than "no filter".
      if (value === undefined || value === null || value === '' || value === false) continue;
      params[key] = String(value);
    }
    return params;
  }
}

/**
 * What each outcome means, in words an operator can act on.
 *
 * Kept beside the type rather than in the template so both screens say the
 * same thing, and so adding an outcome is a compile error here rather than a
 * raw enum value leaking onto the page.
 */
export const OUTCOME_LABELS: Record<InboundOutcome, string> = {
  recorded: 'RSVP recorded',
  unchanged: 'Already said this',
  invalid_secret: 'Rejected — wrong secret',
  malformed_request: 'Rejected — malformed request',
  no_ical: 'No calendar part (a human reply)',
  not_a_reply: 'Not a calendar reply',
  unknown_uid: 'Unrecognised event reference',
  unparseable_attendee: 'Could not read the attendee',
  unhandled_partstat: 'Unsupported response type',
  event_not_found: 'Event missing or unpublished',
  tenant_mismatch: 'Arrived on the wrong community',
  member_not_found: 'No member with that address',
  rate_limited: 'Refused — rate limited',
  counter_proposal: 'Proposed a different time',
};

/** The outcomes that are not failures, so the screen can stop shouting about them. */
export const GOOD_OUTCOMES: readonly InboundOutcome[] = ['recorded', 'unchanged'];

/**
 * Neither a success nor a fault: somebody asked for something.
 *
 * A counter-proposal is a member asking for a different time. Rendering it red
 * would say the deployment broke, and rendering it grey would bury the one row
 * on this screen that somebody should actually answer — so it gets its own
 * treatment, and still appears under "Problems only" because it needs a human.
 */
export const ATTENTION_OUTCOMES: readonly InboundOutcome[] = ['counter_proposal'];
