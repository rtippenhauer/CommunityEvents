import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type ReportContentType =
  | 'event_comment'
  | 'event_comment_reply'
  | 'announcement_comment'
  | 'location_rating';

export interface AdminReport {
  id: number;
  contentType: ReportContentType;
  contentId: number;
  contentLabel: string;
  contentPreview: string;
  reason: string | null;
  reportedBy: { id: number; fullName: string };
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly http = inject(HttpClient);

  submit(contentType: ReportContentType, contentId: number, reason?: string): Observable<void> {
    return this.http.post<void>('/api/v1/reports', { contentType, contentId, reason });
  }

  getAdminReports(): Observable<AdminReport[]> {
    return this.http.get<AdminReport[]>('/api/v1/admin/reports');
  }

  getPendingCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>('/api/v1/admin/reports/pending-count');
  }

  review(id: number, action: 'dismiss' | 'delete_and_dismiss'): Observable<void> {
    return this.http.patch<void>(`/api/v1/admin/reports/${id}`, { action });
  }
}
