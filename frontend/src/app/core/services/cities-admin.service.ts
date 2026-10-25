import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AdminCity {
  id: number;
  name: string;
  isActive: boolean;
  createdAt: string;
}

/** The admin list, which carries the feature's own state beside the rows. */
export interface AdminCitiesResponse {
  cities: AdminCity[];
  enabled: boolean;
}

export interface CreateCityPayload {
  name: string;
  isActive?: boolean;
}

export interface UpdateCityPayload {
  name?: string;
}

/** What retiring a city would move, per table, before anybody commits to it. */
export interface CityRetirementImpact {
  cityId: number;
  cityName: string;
  requiresDestination: boolean;
  rows: Array<{ model: string; label: string; count: number; action: 'move' | 'clear' | 'remove' }>;
}

@Injectable({ providedIn: 'root' })
export class CitiesAdminService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/admin/cities';

  getAll(): Observable<AdminCitiesResponse> {
    return this.http.get<AdminCitiesResponse>(this.base);
  }

  create(payload: CreateCityPayload): Observable<AdminCity> {
    return this.http.post<AdminCity>(this.base, payload);
  }

  update(id: number, payload: UpdateCityPayload): Observable<AdminCity> {
    return this.http.patch<AdminCity>(`${this.base}/${id}`, payload);
  }

  reactivate(id: number): Observable<AdminCity> {
    return this.http.post<AdminCity>(`${this.base}/${id}/reactivate`, {});
  }

  retirementImpact(id: number): Observable<CityRetirementImpact> {
    return this.http.get<CityRetirementImpact>(`${this.base}/${id}/retirement-impact`);
  }

  retire(id: number, moveToCityId?: number): Observable<CityRetirementImpact> {
    return this.http.post<CityRetirementImpact>(`${this.base}/${id}/retire`, { moveToCityId });
  }

  /**
   * Its own route rather than a switch on Admin → Site Settings, because it
   * rewrites data as well as the flag: turning it on backfills every event,
   * venue and member that has no city, and turning it off clears them and
   * retires every city. The settings endpoint refuses this key outright.
   */
  setFeature(enabled: boolean): Observable<{ enabled: boolean }> {
    return this.http.put<{ enabled: boolean }>(`${this.base}/feature`, { enabled });
  }
}
