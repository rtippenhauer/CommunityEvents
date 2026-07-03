import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CalendarSettings {
  url: string;
  cityFilter: 'all' | 'city';
  rsvpOnly: boolean;
  autoInvite: 'none' | 'city' | 'all';
  cityName: string;
}

@Injectable({ providedIn: 'root' })
export class CalendarService {
  private readonly http = inject(HttpClient);

  getSettings(): Observable<CalendarSettings> {
    return this.http.get<CalendarSettings>('/api/v1/calendar/settings');
  }

  updateSettings(patch: { cityFilter?: 'all' | 'city'; rsvpOnly?: boolean; autoInvite?: 'none' | 'city' | 'all' }): Observable<CalendarSettings> {
    return this.http.patch<CalendarSettings>('/api/v1/calendar/settings', patch);
  }

  regenerateToken(): Observable<{ url: string }> {
    return this.http.get<{ url: string }>('/api/v1/calendar/token/regenerate');
  }
}
