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

export interface SystemBug {
  id: number;
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

export interface DemoFeedbackEntry {
  id: number;
  body: string;
  rating: number | null;
  /** Written at submission time: the demo it came from no longer exists. */
  demoLabel: string;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class SystemReportsService {
  private readonly http = inject(HttpClient);

  // ── The shared bug board ──────────────────────────────────────────────────

  listBugs(): Observable<SystemBug[]> {
    return this.http.get<SystemBug[]>('/api/v1/system/bugs');
  }

  fileBug(title: string, body: string): Observable<{ id: number }> {
    return this.http.post<{ id: number }>('/api/v1/system/bugs', { title, body });
  }

  /** Operator only; the API refuses anyone else. */
  updateBug(
    id: number,
    changes: { status?: FeedbackStatus; adminNote?: string },
  ): Observable<SystemBug> {
    return this.http.patch<SystemBug>(`/api/v1/system/bugs/${id}`, changes);
  }

  // ── Demo feedback ─────────────────────────────────────────────────────────

  submitDemoFeedback(body: string, rating: number | null): Observable<{ id: number }> {
    return this.http.post<{ id: number }>('/api/v1/demo/feedback', {
      body,
      ...(rating ? { rating } : {}),
    });
  }

  listDemoFeedback(): Observable<DemoFeedbackEntry[]> {
    return this.http.get<DemoFeedbackEntry[]>('/api/v1/demo/feedback');
  }
}
