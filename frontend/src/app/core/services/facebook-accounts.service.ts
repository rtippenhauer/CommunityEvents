import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * The three states a Facebook person can be in (v2-29).
 *
 * `not_member` is the one worth understanding: somebody an admin has looked at
 * who has no account here. They are **still counted** in the headcount and are
 * simply out of the review queue. Collapsing it into `unmatched` makes the
 * queue never empty; treating it as "ignore" loses a real person from a
 * restaurant booking.
 */
export type FacebookAccountStatus = 'unmatched' | 'linked' | 'not_member';

export interface FacebookAccount {
  id: number;
  profileUrl: string | null;
  facebookUserId: string | null;
  displayName: string;
  status: FacebookAccountStatus;
  userId: number | null;
  memberName: string | null;
  /** Rule 13: a banned or deleted member keeps the link and is flagged here. */
  memberIsBannedOrDeleted: boolean;
  linkedAt: string | null;
  lastSeenAt: string | null;
  /**
   * Members whose full name matches exactly, offered for confirmation.
   *
   * Never a link. Matching is a human decision (rule 5) because a wrong link
   * marks the wrong member Going and emails them about a dinner they never
   * chose -- and two people with one name is not rare in a few hundred.
   */
  suggestions: { id: number; fullName: string }[];
}

/** What linking carried over (rule 14). */
export interface LinkResult {
  upcoming: number;
  attended: number;
}

@Injectable({ providedIn: 'root' })
export class FacebookAccountsService {
  private readonly http = inject(HttpClient);

  list(status?: FacebookAccountStatus): Observable<FacebookAccount[]> {
    return this.http.get<FacebookAccount[]>('/api/v1/admin/facebook-accounts', {
      params: status === undefined ? {} : { status },
    });
  }

  /**
   * Ties a Facebook person to a member.
   *
   * Returns what the carry-over did (rule 14): upcoming dinners that became
   * Going RSVPs, and past ones where a marked attendance was credited with
   * points. Both are the immediate consequence of the link, so the screen says
   * so rather than leaving an admin to wonder whether anything happened.
   */
  link(accountId: number, userId: number): Observable<LinkResult> {
    return this.http.post<LinkResult>(
      `/api/v1/admin/facebook-accounts/${accountId}/link`,
      { userId },
    );
  }

  /** Returns the person to the queue. Leaves any synced RSVP in place. */
  unlink(accountId: number): Observable<void> {
    return this.http.post<void>(`/api/v1/admin/facebook-accounts/${accountId}/unlink`, {});
  }

  markNotAMember(accountId: number): Observable<void> {
    return this.http.post<void>(
      `/api/v1/admin/facebook-accounts/${accountId}/not-a-member`,
      {},
    );
  }

  markUnmatched(accountId: number): Observable<void> {
    return this.http.post<void>(`/api/v1/admin/facebook-accounts/${accountId}/unmatched`, {});
  }

  /** `attended: null` puts a row back to "not marked", which is a third state. */
  markAttendance(
    accountId: number,
    eventId: number,
    attended: boolean | null,
  ): Observable<void> {
    return this.http.patch<void>(
      `/api/v1/admin/facebook-accounts/${accountId}/attendance`,
      { eventId, ...(attended === null ? {} : { attended }) },
    );
  }
}
