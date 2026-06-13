import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { FeedbackItem } from './feedback.service';

export interface Release {
  id: number;
  version: string;
  title: string;
  body: string;
  publishedAt: string | null;
  createdAt: string;
  author: { id: number; fullName: string };
  linkedFeedback: FeedbackItem[];
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
}
