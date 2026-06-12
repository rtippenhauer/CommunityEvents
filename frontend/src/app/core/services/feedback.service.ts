import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export type FeedbackCategory = 'bug' | 'feature_request' | 'comment';
export type FeedbackStatus = 'open' | 'in_progress' | 'resolved' | 'shipped' | 'closed' | 'wont_fix';

export interface FeedbackUser {
  id: number;
  fullName: string;
  email: string;
}

export interface FeedbackNote {
  id: number;
  feedbackId: number;
  authorId: number;
  author: { id: number; fullName: string };
  content: string;
  isAdminOnly: boolean;
  createdAt: string;
}

export interface FeedbackLinkedRelease {
  id: number;
  version: string;
  title: string;
  publishedAt: string | null;
}

export interface FeedbackItem {
  id: number;
  userId: number;
  user: FeedbackUser | null;
  title: string | null;
  category: FeedbackCategory;
  body: string;
  status: FeedbackStatus;
  adminNote: string | null;
  releaseNote: string | null;
  releases?: FeedbackLinkedRelease[];
  isPrivate: boolean;
  upvoteCount: number;
  hasUpvoted?: boolean;
  seenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getLinkedRelease(item: FeedbackItem): FeedbackLinkedRelease | null {
  return item.releases?.find((r) => r.publishedAt != null) ?? item.releases?.[0] ?? null;
}

export interface CreateFeedbackDto {
  category: FeedbackCategory;
  title: string;
  body: string;
  isPrivate?: boolean;
}

export interface UpdateFeedbackDto {
  status?: FeedbackStatus;
  adminNote?: string | null;
  releaseNote?: string | null;
}

export interface CreateNoteDto {
  content: string;
  isAdminOnly?: boolean;
}

export interface MemberFeedbackStats {
  bugsReported: number;
  featuresRequested: number;
  shippedCount: number;
}

export const STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  shipped: 'Shipped',
  closed: 'Closed',
  wont_fix: "Won't Fix",
};

export const STATUS_COLORS: Record<FeedbackStatus, string> = {
  open: '#1565c0',
  in_progress: '#e65100',
  resolved: '#6a1b9a',
  shipped: '#2e7d32',
  closed: '#757575',
  wont_fix: '#9e9e9e',
};

export const CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: 'Bug',
  feature_request: 'Feature',
  comment: 'Comment',
};

export const CATEGORY_COLORS: Record<FeedbackCategory, string> = {
  bug: '#c62828',
  feature_request: '#1565c0',
  comment: '#555',
};

@Injectable({ providedIn: 'root' })
export class FeedbackService {
  private readonly http = inject(HttpClient);

  readonly unseenCount = signal(0);

  // ── Member ────────────────────────────────────────────────────────────────

  submit(dto: CreateFeedbackDto): Observable<FeedbackItem> {
    return this.http.post<FeedbackItem>('/api/v1/feedback', dto);
  }

  getPublicList(category?: FeedbackCategory, sort?: 'newest' | 'upvotes'): Observable<FeedbackItem[]> {
    let params = new HttpParams();
    if (category) params = params.set('category', category);
    if (sort) params = params.set('sort', sort);
    return this.http.get<FeedbackItem[]>('/api/v1/feedback', { params });
  }

  getMine(): Observable<FeedbackItem[]> {
    return this.http.get<FeedbackItem[]>('/api/v1/feedback/mine');
  }

  getOne(id: number): Observable<FeedbackItem> {
    return this.http.get<FeedbackItem>(`/api/v1/feedback/${id}`);
  }

  toggleUpvote(id: number): Observable<{ upvoteCount: number; hasUpvoted: boolean }> {
    return this.http.post<{ upvoteCount: number; hasUpvoted: boolean }>(`/api/v1/feedback/${id}/upvote`, {});
  }

  getNotes(id: number): Observable<FeedbackNote[]> {
    return this.http.get<FeedbackNote[]>(`/api/v1/feedback/${id}/notes`);
  }

  addNote(id: number, dto: CreateNoteDto): Observable<FeedbackNote> {
    return this.http.post<FeedbackNote>(`/api/v1/feedback/${id}/notes`, dto);
  }

  getMyStats(): Observable<MemberFeedbackStats> {
    return this.http.get<MemberFeedbackStats>('/api/v1/feedback/my-stats');
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  getAll(): Observable<FeedbackItem[]> {
    return this.http.get<FeedbackItem[]>('/api/v1/admin/feedback');
  }

  update(id: number, dto: UpdateFeedbackDto): Observable<FeedbackItem> {
    return this.http.patch<FeedbackItem>(`/api/v1/admin/feedback/${id}`, dto);
  }

  addAdminNote(id: number, dto: CreateNoteDto): Observable<FeedbackNote> {
    return this.http.post<FeedbackNote>(`/api/v1/admin/feedback/${id}/notes`, dto);
  }

  loadUnseenCount(): void {
    this.http.get<{ count: number }>('/api/v1/admin/feedback/unseen-count').subscribe({
      next: (res) => this.unseenCount.set(res.count),
      error: () => {},
    });
  }

  markSeen(id: number): Observable<FeedbackItem> {
    return this.http.patch<FeedbackItem>(`/api/v1/admin/feedback/${id}/seen`, {}).pipe(
      tap(() => {
        const current = this.unseenCount();
        if (current > 0) this.unseenCount.set(current - 1);
      }),
    );
  }

  markAllSeen(): Observable<{ count: number }> {
    return this.http.patch<{ count: number }>('/api/v1/admin/feedback/mark-all-seen', {}).pipe(
      tap(() => this.unseenCount.set(0)),
    );
  }
}
