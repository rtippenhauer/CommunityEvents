import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { FeedbackItem } from './feedback.service';

export interface ReportCandidate {
  id: number;
  title: string;
  category: string;
  status: string;
  shippedInReleaseId: number | null;
  shippedInVersion: string | null;
}

export interface Release {
  id: number;
  version: string;
  title: string;
  body: string;
  publishedAt: string | null;
  createdAt: string;
  author: { id: number; fullName: string };
  /** Tickets from *this* community — the only ones the API will name. */
  linkedFeedback: FeedbackItem[];
  /**
   * How many linked tickets came from another community. The API deliberately
   * sends a number and not ids or names: those members are credited by their
   * own community, not by this one.
   */
  anonymousCredits?: number;
}

export interface CreateReleaseDto {
  version: string;
  title: string;
  body: string;
  feedbackIds?: number[];
}

@Injectable({ providedIn: 'root' })
export class ReleasesService {
  private readonly http = inject(HttpClient);

  // ── Public ────────────────────────────────────────────────────────────────

  getPublished(): Observable<Release[]> {
    return this.http.get<Release[]>('/api/v1/releases');
  }

  getPublishedOne(id: number): Observable<Release> {
    return this.http.get<Release>(`/api/v1/releases/${id}`);
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  getAll(): Observable<Release[]> {
    return this.http.get<Release[]>('/api/v1/admin/releases');
  }

  /**
   * Bugs & requests this release may credit (v2-43). Returns `resolved` and
   * `shipped` reports both, each carrying the release that currently holds it,
   * so an operator can see where a report sits and move it.
   */
  getReportCandidates(): Observable<ReportCandidate[]> {
    return this.http.get<ReportCandidate[]>('/api/v1/admin/releases/report-candidates');
  }

  /** Credit a report on this release, moving it off whichever release holds it. */
  linkReport(releaseId: number, reportId: number): Observable<void> {
    return this.http.post<void>(`/api/v1/admin/releases/${releaseId}/reports/${reportId}`, {});
  }

  /** Remove a report's credit. Its status stays shipped. */
  unlinkReport(reportId: number): Observable<void> {
    return this.http.delete<void>(`/api/v1/admin/releases/reports/${reportId}`);
  }

  getResolvedFeedback(): Observable<FeedbackItem[]> {
    return this.http.get<FeedbackItem[]>('/api/v1/admin/releases/resolved-feedback');
  }

  create(dto: CreateReleaseDto): Observable<Release> {
    return this.http.post<Release>('/api/v1/admin/releases', dto);
  }

  update(id: number, dto: Partial<CreateReleaseDto>): Observable<Release> {
    return this.http.patch<Release>(`/api/v1/admin/releases/${id}`, dto);
  }

  publish(id: number): Observable<Release> {
    return this.http.post<Release>(`/api/v1/admin/releases/${id}/publish`, {});
  }

  unpublish(id: number): Observable<Release> {
    return this.http.post<Release>(`/api/v1/admin/releases/${id}/unpublish`, {});
  }
}
