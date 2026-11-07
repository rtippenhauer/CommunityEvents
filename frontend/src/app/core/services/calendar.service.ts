import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CalendarSettings {
  url: string;
  rsvpOnly: boolean;
  /**
   * On/off since v2-24, where it used to be `none | city | all`. Which cities
   * it covers is `cityIds`, so the two "on" arms became one flag plus a set
   * that can name more than one city.
   */
  autoInvite: boolean;
  /** The member's chosen cities. **Empty means every city.** */
  cityIds: number[];
  /** Active cities to choose from, so the screen needs one request, not two. */
  cities: Array<{ id: number; name: string }>;
  citiesEnabled: boolean;
}

export interface CalendarSettingsPatch {
  rsvpOnly?: boolean;
  autoInvite?: boolean;
  /**
   * The whole set, replaced wholesale. An empty array is a real choice —
   * "every city" — and is not the same as omitting the key, which leaves the
   * set alone.
   */
  cityIds?: number[];
}

@Injectable({ providedIn: 'root' })
export class CalendarService {
  private readonly http = inject(HttpClient);

  getSettings(): Observable<CalendarSettings> {
    return this.http.get<CalendarSettings>('/api/v1/calendar/settings');
  }

  updateSettings(patch: CalendarSettingsPatch): Observable<CalendarSettings> {
    return this.http.patch<CalendarSettings>('/api/v1/calendar/settings', patch);
  }

  regenerateToken(): Observable<{ url: string }> {
    return this.http.get<{ url: string }>('/api/v1/calendar/token/regenerate');
  }
}
