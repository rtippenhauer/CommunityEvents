import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type EventStatus = 'draft' | 'published' | 'cancelled';

export interface EventRestaurant {
  id: number;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  photos: Array<{ id: number; filePath: string }>;
}

export interface GuestLink {
  id: number;
  token: string;
  recipientName: string | null;
  usedAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface Rsvp {
  id: number;
  eventId: number;
  userId: number;
  user: { id: number; fullName: string; profilePhotoPath: string | null };
  additionalGuests: number;
  guestNames: string[] | null;
  guestLinks: GuestLink[];
  createdAt: string;
}

export interface Event {
  id: number;
  cityId: number;
  city: { id: number; name: string; subdomain: string };
  restaurantId: number | null;
  restaurant: EventRestaurant | null;
  restaurantName: string;
  restaurantAddress: string;
  restaurantLat: number | null;
  restaurantLng: number | null;
  title: string;
  description: string | null;
  additionalInfo: string | null;
  eventDate: string;
  eventTime: string;
  status: EventStatus;
  publishedAt: string | null;
  cancelledAt: string | null;
  cancelledReason: string | null;
  facebookShareText: string | null;
  createdById: number;
  createdByUser: { id: number; fullName: string; profilePhotoPath: string | null };
  rsvps: Rsvp[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateEventPayload {
  cityId: number;
  restaurantId: number;
  title: string;
  description?: string | null;
  additionalInfo?: string | null;
  eventDate: string;
  eventTime: string;
  status?: EventStatus;
}

export interface UpdateEventPayload {
  restaurantId?: number;
  title?: string;
  description?: string | null;
  additionalInfo?: string | null;
  eventDate?: string;
  eventTime?: string;
  status?: EventStatus;
  cancelledReason?: string | null;
}

@Injectable({ providedIn: 'root' })
export class EventsService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/events';

  getAll(filters: { cityId?: number; upcoming?: boolean; status?: EventStatus } = {}): Observable<Event[]> {
    const params: Record<string, string> = {};
    if (filters.cityId) params['cityId'] = String(filters.cityId);
    if (filters.upcoming !== undefined) params['upcoming'] = String(filters.upcoming);
    if (filters.status) params['status'] = filters.status;
    return this.http.get<Event[]>(this.base, { params });
  }

  getOne(id: number): Observable<Event> {
    return this.http.get<Event>(`${this.base}/${id}`);
  }

  create(payload: CreateEventPayload): Observable<Event> {
    return this.http.post<Event>(this.base, payload);
  }

  update(id: number, payload: UpdateEventPayload): Observable<Event> {
    return this.http.patch<Event>(`${this.base}/${id}`, payload);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  rsvp(eventId: number, additionalGuests: number, guestNames?: string[]): Observable<Rsvp> {
    return this.http.post<Rsvp>(`${this.base}/${eventId}/rsvp`, { additionalGuests, guestNames });
  }

  unrsvp(eventId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${eventId}/rsvp`);
  }

  generateGuestLink(eventId: number, recipientName?: string): Observable<GuestLink> {
    return this.http.post<GuestLink>(`${this.base}/${eventId}/rsvp/link`, { recipientName });
  }

  mapsUrl(lat: number | null, lng: number | null, address: string): string {
    if (lat && lng) return `https://www.google.com/maps?q=${lat},${lng}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }
}
