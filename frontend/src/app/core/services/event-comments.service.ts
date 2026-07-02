import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CommentReply {
  id: number;
  memberId: number;
  memberName: string;
  memberPhoto: string | null;
  body: string | null;
  deleted: boolean;
  createdAt: string;
}

export interface Comment {
  id: number;
  memberId: number;
  memberName: string;
  memberPhoto: string | null;
  body: string | null;
  deleted: boolean;
  createdAt: string;
  replies: CommentReply[];
}

export interface AttendanceEntry {
  type: 'member' | 'guest';
  userId?: number;
  guestLinkId?: number;
  memberName: string;
  recipientEmail?: string | null;
  attended: boolean | null;
  isWalkin: boolean;
  fromOtherCity: boolean;
  linkUsed: boolean;
}

export interface MemberSearchResult {
  id: number;
  fullName: string;
}

@Injectable({ providedIn: 'root' })
export class EventCommentsService {
  private readonly http = inject(HttpClient);

  getComments(eventId: number): Observable<Comment[]> {
    return this.http.get<Comment[]>(`/api/v1/events/${eventId}/comments`);
  }

  addComment(eventId: number, body: string): Observable<Comment> {
    return this.http.post<Comment>(`/api/v1/events/${eventId}/comments`, { body });
  }

  deleteComment(eventId: number, commentId: number): Observable<void> {
    return this.http.delete<void>(`/api/v1/events/${eventId}/comments/${commentId}`);
  }

  addReply(eventId: number, commentId: number, body: string): Observable<CommentReply> {
    return this.http.post<CommentReply>(`/api/v1/events/${eventId}/comments/${commentId}/replies`, { body });
  }

  deleteReply(eventId: number, commentId: number, replyId: number): Observable<void> {
    return this.http.delete<void>(`/api/v1/events/${eventId}/comments/${commentId}/replies/${replyId}`);
  }

  getAttendance(eventId: number): Observable<AttendanceEntry[]> {
    return this.http.get<AttendanceEntry[]>(`/api/v1/events/${eventId}/attendance`);
  }

  markAttendance(eventId: number, attendances: { userId: number; attended: boolean; fromOtherCity?: boolean }[]): Observable<void> {
    return this.http.patch<void>(`/api/v1/events/${eventId}/attendance`, { attendances });
  }

  addWalkin(eventId: number, userId: number): Observable<AttendanceEntry> {
    return this.http.post<AttendanceEntry>(`/api/v1/events/${eventId}/attendance/walkin`, { userId });
  }

  markGuestAttendance(guestLinkId: number, attended: boolean): Observable<void> {
    return this.http.patch<void>(`/api/v1/events/guest-links/${guestLinkId}/attendance`, { attended });
  }

  resendGuestInvite(guestLinkId: number): Observable<void> {
    return this.http.post<void>(`/api/v1/events/guest-links/${guestLinkId}/resend`, {});
  }

  searchMembers(eventId: number, query: string): Observable<MemberSearchResult[]> {
    return this.http.get<MemberSearchResult[]>(`/api/v1/events/${eventId}/members/search`, { params: { q: query } });
  }
}
