import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

interface AnnouncementAuthor {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
}

export interface AnnouncementComment {
  id: number;
  userId: number;
  user: AnnouncementAuthor;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface Announcement {
  id: number;
  title: string;
  body: string;
  cityId: number | null;
  city: { id: number; name: string } | null;
  status: 'draft' | 'published';
  publishedAt: string | null;
  createdBy: number;
  author: AnnouncementAuthor;
  comments: AnnouncementComment[];
  createdAt: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class AnnouncementsService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/announcements';
  private readonly adminBase = '/api/v1/admin/announcements';

  getAll(cityId?: number): Observable<Announcement[]> {
    const params: Record<string, string> = cityId ? { cityId: String(cityId) } : {};
    return this.http.get<Announcement[]>(this.base, { params });
  }

  getOne(id: number): Observable<Announcement> {
    return this.http.get<Announcement>(`${this.base}/${id}`);
  }

  addComment(announcementId: number, body: string): Observable<AnnouncementComment> {
    return this.http.post<AnnouncementComment>(`${this.base}/${announcementId}/comments`, { body });
  }

  editComment(commentId: number, body: string): Observable<AnnouncementComment> {
    return this.http.patch<AnnouncementComment>(`${this.base}/comments/${commentId}`, { body });
  }

  deleteComment(commentId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/comments/${commentId}`);
  }

  flagContent(contentType: string, contentId: number, reason?: string): Observable<void> {
    return this.http.post<void>(`${this.base}/flag`, { contentType, contentId, reason });
  }

  // Admin
  adminGetAll(): Observable<Announcement[]> {
    return this.http.get<Announcement[]>(this.adminBase);
  }

  adminGetOne(id: number): Observable<Announcement> {
    return this.http.get<Announcement>(`${this.adminBase}/${id}`);
  }

  adminCreate(data: { title: string; body: string; cityId?: number | null }): Observable<Announcement> {
    return this.http.post<Announcement>(this.adminBase, data);
  }

  adminUpdate(id: number, data: { title: string; body: string; cityId?: number | null }): Observable<Announcement> {
    return this.http.patch<Announcement>(`${this.adminBase}/${id}`, data);
  }

  adminPublish(id: number): Observable<Announcement> {
    return this.http.post<Announcement>(`${this.adminBase}/${id}/publish`, {});
  }

  adminDelete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.adminBase}/${id}`);
  }

  adminGetFlags(): Observable<any[]> {
    return this.http.get<any[]>(`${this.adminBase}/flags`);
  }

  adminGetPendingFlagCount(): Observable<{ count: number }> {
    return this.http.get<{ count: number }>(`${this.adminBase}/flags/pending-count`);
  }

  adminResolveFlag(flagId: number, status: 'reviewed' | 'dismissed'): Observable<any> {
    return this.http.patch(`${this.adminBase}/flags/${flagId}`, { status });
  }
}
