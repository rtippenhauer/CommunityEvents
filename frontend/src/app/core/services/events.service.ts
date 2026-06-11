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
  websiteUrl: string | null;
  photos: Array<{ id: number; filePath: string }>;
}

export interface GuestLink {
  id: number;
  token: string;
  recipientName: string | null;
  usedAt: string | null;
  cancelledAt: string | null;
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
  guestLinks: GuestLink[] | undefined;
  createdAt: string;
}

export interface PublicRsvp {
  id: number;
  recipientName: string | null;
  cancelledAt: string | null;
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
  publicRsvps: PublicRsvp[];
  createdAt: string;
  updatedAt: string;
}

export interface GuestLinkInfo {
  eventTitle: string;
  eventDate: string;
  eventTime: string;
  eventStatus: string;
  restaurantName: string;
  restaurantAddress: string;
  restaurantLat: number | null;
  restaurantLng: number | null;
  restaurantPhotoUrl: string | null;
  invitedByName: string;
  recipientName: string | null;
  usedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string;
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
  cityId?: number;
  restaurantId?: number;
  title?: string;
  description?: string | null;
  additionalInfo?: string | null;
  facebookShareText?: string | null;
  eventDate?: string;
  eventTime?: string;
  status?: EventStatus;
  cancelledReason?: string | null;
}

@Injectable({ providedIn: 'root' })
export class EventsService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/events';

  private readonly noCache = { headers: { 'Cache-Control': 'no-cache' } };

  getAll(filters: { cityId?: number; upcoming?: boolean; fromDate?: string; status?: EventStatus } = {}): Observable<Event[]> {
    const params: Record<string, string> = {};
    if (filters.cityId) params['cityId'] = String(filters.cityId);
    if (filters.fromDate) params['fromDate'] = filters.fromDate;
    else if (filters.upcoming !== undefined) params['upcoming'] = String(filters.upcoming);
    if (filters.status) params['status'] = filters.status;
    return this.http.get<Event[]>(this.base, { params, ...this.noCache });
  }

  getOne(id: number): Observable<Event> {
    return this.http.get<Event>(`${this.base}/${id}`, this.noCache);
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

  generateGuestLink(eventId: number, recipientName?: string, recipientEmail?: string): Observable<GuestLink> {
    return this.http.post<GuestLink>(`${this.base}/${eventId}/rsvp/link`, { recipientName, recipientEmail });
  }

  getGuestLinkInfo(token: string): Observable<GuestLinkInfo> {
    return this.http.get<GuestLinkInfo>(`${this.base}/guest-link/${token}`);
  }

  confirmGuestRsvp(token: string, guestName?: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.base}/guest-link/${token}`, { guestName });
  }

  cancelGuestRsvp(token: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/guest-link/${token}`);
  }

  removeGuestLink(eventId: number, linkId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${eventId}/rsvp/link/${linkId}`);
  }

  publicRsvp(eventId: number, name: string, email: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(`${this.base}/${eventId}/public-rsvp`, { name, email });
  }

  mapsUrl(lat: number | null, lng: number | null, address: string): string {
    if (lat && lng) return `https://www.google.com/maps?q=${lat},${lng}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }

  googleCalendarUrl(event: Event): string {
    const [y, m, d] = event.eventDate.split('-').map(Number);
    const [h, min] = event.eventTime.split(':').map(Number);
    const pad = (n: number) => String(n).padStart(2, '0');
    const startDt = `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(min)}00`;
    const endDt = `${y}${pad(m)}${pad(d)}T${pad(h + 2)}${pad(min)}00`;
    const details: string[] = [`🍽️ ${event.restaurantName}`];
    if (event.description) details.push(event.description);
    if (event.additionalInfo) details.push(event.additionalInfo);
    details.push(`View event: ${window.location.origin}/events/${event.id}`);
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: event.title,
      dates: `${startDt}/${endDt}`,
      location: event.restaurantAddress,
      details: details.join('\n\n'),
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  generatePostText(event: Event): string {
    if (event.facebookShareText) return event.facebookShareText;
    const [y, m, d] = event.eventDate.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dateStr = date.toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });
    const [h, min] = event.eventTime.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const timeStr = `${h % 12 || 12}:${String(min).padStart(2, '0')} ${ampm}`;
    const lines = [
      `🐻 DinnerBears Dinner Night!\n`,
      `🍽️ ${event.restaurantName}`,
      `📅 ${dateStr} at ${timeStr}`,
      `📍 ${event.restaurantAddress}`,
    ];
    if (event.description) lines.push(`\n${event.description}`);
    lines.push(`\nRSVP: ${window.location.origin}/events/${event.id}`);
    const cityHost = window.location.hostname;
    lines.push(`\nNot a member yet? Visit https://${cityHost} to join DinnerBears!`);
    return lines.join('\n');
  }
}
