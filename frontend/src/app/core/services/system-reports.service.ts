import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { FeedbackStatus } from './feedback.service';

/**
 * How the API describes who filed a report, which is the whole privacy design
 * expressed as a type (v2-32).
 *
 * The server decides; the client renders what it is given and has no branch
 * that could reconstruct a name. `other` carries no fields at all -- not an
 * empty name, not a community -- so there is nothing here to leak by accident
 * and nothing to tempt a future template into `reporter.fullName ?? '...'`.
 */
export type Reporter =
  | { kind: 'self'; fullName: string }
  | { kind: 'other' }
  | { kind: 'operator'; fullName: string; community: string }
  | { kind: 'departed' };

export type SystemReportCategory = 'bug' | 'feature_request';

export interface SystemBug {
  id: number;
  category: SystemReportCategory;
  title: string;
  body: string;
  status: FeedbackStatus;
  /** Null for everyone but the operator — their triage note is not shared. */
  adminNote: string | null;
  reporter: Reporter;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export type DemoWouldUse = 'yes' | 'maybe' | 'no';

/** One returned survey. Every answer is optional, so every field is nullable. */
export interface DemoFeedbackEntry {
  id: number;
  body: string | null;
  rating: number | null;
  wouldUse: DemoWouldUse | null;
  whatWorked: string | null;
  whatDidnt: string | null;
  /** Written at submission time: the demo it came from no longer exists. */
  demoLabel: string;
  createdAt: string;
}

/** What the survey form sends. Nulls are omitted rather than sent as null. */
export interface DemoSurveyAnswers {
  rating: number | null;
  wouldUse: string | null;
  whatWorked: string | null;
  whatDidnt: string | null;
  body: string | null;
}

@Injectable({ providedIn: 'root' })
export class SystemReportsService {
  private readonly http = inject(HttpClient);

  // ── The shared bug board ──────────────────────────────────────────────────

  listBugs(): Observable<SystemBug[]> {
    return this.http.get<SystemBug[]>('/api/v1/system/bugs');
  }

  fileBug(
    category: SystemReportCategory,
    title: string,
    body: string,
  ): Observable<{ id: number }> {
    return this.http.post<{ id: number }>('/api/v1/system/bugs', { category, title, body });
  }

  /** Operator only; the API refuses anyone else. */
  updateBug(
    id: number,
    changes: { status?: FeedbackStatus; adminNote?: string },
  ): Observable<SystemBug> {
    return this.http.patch<SystemBug>(`/api/v1/system/bugs/${id}`, changes);
  }

  // ── Demo feedback ─────────────────────────────────────────────────────────

  /**
   * Unanswered questions are left out of the payload entirely rather than sent
   * as null: the DTO's validators are `@IsOptional()`, which skips an absent
   * field and rejects an explicit null.
   */
  submitDemoFeedback(answers: DemoSurveyAnswers): Observable<{ id: number }> {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(answers)) {
      if (value !== null && value !== '') payload[key] = value;
    }
    return this.http.post<{ id: number }>('/api/v1/demo/feedback', payload);
  }

  listDemoFeedback(): Observable<DemoFeedbackEntry[]> {
    return this.http.get<DemoFeedbackEntry[]>('/api/v1/demo/feedback');
  }
}
