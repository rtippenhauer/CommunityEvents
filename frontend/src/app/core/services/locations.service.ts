import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface LocationPhoto {
  id: number;
  filePath: string;
  fileName: string;
  sortOrder: number;
}

interface LocationUser {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
}

export interface Location {
  id: number;
  name: string;
  address: string;
  lat: number | null;
  lng: number | null;
  phone: string | null;
  websiteUrl: string | null;
  description: string | null;
  cityId: number;
  city: { id: number; name: string; subdomain: string };
  isActive: boolean;
  photos: LocationPhoto[];
  createdAt: string;
  updatedAt: string;
  enrichedAt: string | null;
  createdByUser: LocationUser | null;
  updatedByUser: LocationUser | null;
  // Moderator-only fields (omitted for non-mod users)
  moderatorNotes?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export interface CreateLocationPayload {
  name: string;
  address: string;
  phone?: string | null;
  websiteUrl?: string | null;
  description?: string | null;
  cityId: number;
  moderatorNotes?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export interface UpdateLocationPayload extends Partial<CreateLocationPayload> {
  isActive?: boolean;
}

interface RatingAggregate {
  count: number;
  avgFood: number | null;
  avgService: number | null;
  avgValue: number | null;
  avgNoise: number | null;
  avgOverall: number | null;
}

interface ReviewItem {
  id: number;
  memberId: number;
  memberName: string;
  memberPhoto: string | null;
  eventDate: string;
  food: number;
  service: number;
  valueRating: number;
  noise: number;
  comment: string | null;
  createdAt: string;
}

export interface EligibleEvent {
  id: number;
  title: string;
  eventDate: string;
  alreadyRated: boolean;
}

export interface RatingsResponse {
  aggregate: RatingAggregate;
  reviews: ReviewItem[];
  eligibleEvents: EligibleEvent[];
}

export interface CreateRatingPayload {
  eventId: number;
  food: number;
  service: number;
  valueRating: number;
  noise: number;
  comment?: string;
}

export interface RatingQueueItem {
  locationId: number;
  locationName: string;
  locationPhotoUrl: string | null;
  eventId: number;
  eventDate: string;
  alreadyRated: boolean;
}

export interface PlaceSearchResult {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface ImportDetail {
  name: string;
  status: 'inserted' | 'skipped' | 'error';
  reason?: string;
}

export interface ImportResult {
  inserted: number;
  skipped: number;
  errors: number;
  details: ImportDetail[];
}

@Injectable({ providedIn: 'root' })
export class LocationsService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/locations';

  getAll(cityId?: number, search?: string): Observable<Location[]> {
    const params: Record<string, string> = {};
    if (cityId) params['cityId'] = String(cityId);
    if (search) params['search'] = search;
    return this.http.get<Location[]>(this.base, { params });
  }

  getOne(id: number): Observable<Location> {
    return this.http.get<Location>(`${this.base}/${id}`);
  }

  getArchived(cityId?: number, search?: string): Observable<Location[]> {
    const params: Record<string, string> = {};
    if (cityId) params['cityId'] = String(cityId);
    if (search) params['search'] = search;
    return this.http.get<Location[]>(`${this.base}/archived`, { params });
  }

  restore(id: number): Observable<Location> {
    return this.http.patch<Location>(`${this.base}/${id}/restore`, {});
  }

  create(payload: CreateLocationPayload): Observable<Location> {
    return this.http.post<Location>(this.base, payload);
  }

  update(id: number, payload: UpdateLocationPayload): Observable<Location> {
    return this.http.patch<Location>(`${this.base}/${id}`, payload);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  addPhoto(locationId: number, file: File): Observable<LocationPhoto> {
    const form = new FormData();
    form.append('photo', file);
    return this.http.post<LocationPhoto>(`${this.base}/${locationId}/photos`, form);
  }

  deletePhoto(locationId: number, photoId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${locationId}/photos/${photoId}`);
  }

  diagnose(id: number): Observable<unknown> {
    return this.http.get(`${this.base}/${id}/enrich/diagnose`);
  }

  bulkEnrich(): Observable<{ started: boolean; total: number }> {
    return this.http.post<{ started: boolean; total: number }>(`${this.base}/enrich/bulk`, {});
  }

  enrich(id: number): Observable<{ placeFound: boolean; description: string | null; phone: string | null; website: string | null; address: string | null; photoAdded: boolean; location: Location }> {
    return this.http.post<{ placeFound: boolean; description: string | null; phone: string | null; website: string | null; address: string | null; photoAdded: boolean; location: Location }>(`${this.base}/${id}/enrich`, {});
  }

  importFacebook(file: File, cityId: number): Observable<ImportResult> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ImportResult>(`${this.base}/import/facebook?cityId=${cityId}`, form);
  }

  getRatings(locationId: number): Observable<RatingsResponse> {
    return this.http.get<RatingsResponse>(`${this.base}/${locationId}/ratings`);
  }

  submitRating(locationId: number, payload: CreateRatingPayload): Observable<unknown> {
    return this.http.post(`${this.base}/${locationId}/ratings`, payload);
  }

  placeSearch(q: string): Observable<PlaceSearchResult[]> {
    return this.http.get<PlaceSearchResult[]>(`${this.base}/place-search`, { params: { q } });
  }

  getRatingQueue(): Observable<RatingQueueItem[]> {
    return this.http.get<RatingQueueItem[]>(`${this.base}/rating-queue`);
  }

  googleMapsUrl(location: Location): string | null {
    if (location.lat && location.lng) {
      return `https://www.google.com/maps?q=${location.lat},${location.lng}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.address)}`;
  }
}
