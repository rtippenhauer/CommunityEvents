import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export type FeedbackCategory = 'bug' | 'feature_request' | 'comment';
export type FeedbackStatus = 'new' | 'under_review' | 'in_progress' | 'released' | 'wont_do' | 'duplicate';

export interface FeedbackItem {
  id: number;
  userId: number;
  user: { id: number; fullName: string; email: string };
  category: FeedbackCategory;
  body: string;
  status: FeedbackStatus;
  adminNote: string | null;
  seenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFeedbackDto {
  category: FeedbackCategory;
  body: string;
}

export interface UpdateFeedbackDto {
  status?: FeedbackStatus;
  adminNote?: string | null;
}

@Injectable({ providedIn: 'root' })
export class FeedbackService {
  private readonly http = inject(HttpClient);

  readonly unseenCount = signal(0);

  submit(dto: CreateFeedbackDto): Observable<FeedbackItem> {
    return this.http.post<FeedbackItem>('/api/v1/feedback', dto);
  }

  getAll(): Observable<FeedbackItem[]> {
    return this.http.get<FeedbackItem[]>('/api/v1/feedback');
  }

  update(id: number, dto: UpdateFeedbackDto): Observable<FeedbackItem> {
    return this.http.patch<FeedbackItem>(`/api/v1/feedback/${id}`, dto);
  }

  loadUnseenCount(): void {
    this.http.get<{ count: number }>('/api/v1/feedback/unseen-count').subscribe({
      next: (res) => this.unseenCount.set(res.count),
      error: () => {},
    });
  }

  markSeen(id: number): Observable<FeedbackItem> {
    return this.http.patch<FeedbackItem>(`/api/v1/feedback/${id}/seen`, {}).pipe(
      tap(() => {
        const current = this.unseenCount();
        if (current > 0) this.unseenCount.set(current - 1);
      }),
    );
  }
}
