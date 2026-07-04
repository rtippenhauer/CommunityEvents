import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type InviteFlavor = 'member' | 'non_validated';

export interface InvitePreview {
  token: string;
  flavor: InviteFlavor;
  isRevoked: boolean;
  isExpired: boolean;
  isFull: boolean;
  expiresAt: string;
  event: {
    id: number;
    title: string;
    eventDate: string;
    eventTime: string;
    status: string;
    restaurantName: string;
    restaurantAddress: string;
    restaurantPhotoUrl: string | null;
  } | null;
}

export interface EventInviteLink {
  id: number;
  token: string;
  inviteFlavor: InviteFlavor;
  maxUses: number | null;
  useCount: number;
  expiresAt: string;
  isRevoked: boolean;
  createdAt: string;
  creator: { id: number; fullName: string };
}

export interface CreateEventInviteDto {
  flavor: InviteFlavor;
}

@Injectable({ providedIn: 'root' })
export class InvitesService {
  private readonly http = inject(HttpClient);

  previewInvite(token: string): Observable<InvitePreview> {
    return this.http.get<InvitePreview>(`/api/v1/invites/preview/${token}`);
  }

  getEventInviteLinks(eventId: number): Observable<EventInviteLink[]> {
    return this.http.get<EventInviteLink[]>(`/api/v1/events/${eventId}/invite-links`);
  }

  createEventInviteLink(eventId: number, dto: CreateEventInviteDto): Observable<EventInviteLink> {
    return this.http.post<EventInviteLink>(`/api/v1/events/${eventId}/invite-links`, dto);
  }

  revokeEventInviteLink(eventId: number, inviteId: number): Observable<void> {
    return this.http.patch<void>(`/api/v1/events/${eventId}/invite-links/${inviteId}/revoke`, {});
  }
}
