import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface RestaurantPhoto {
  id: number;
  filePath: string;
  fileName: string;
  sortOrder: number;
}

export interface RestaurantUser {
  id: number;
  fullName: string;
  profilePhotoPath: string | null;
}

export interface Restaurant {
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
  photos: RestaurantPhoto[];
  createdAt: string;
  updatedAt: string;
  enrichedAt: string | null;
  createdByUser: RestaurantUser | null;
  updatedByUser: RestaurantUser | null;
  // Moderator-only fields (omitted for non-mod users)
  moderatorNotes?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export interface CreateRestaurantPayload {
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

export interface UpdateRestaurantPayload extends Partial<CreateRestaurantPayload> {
  isActive?: boolean;
}

export interface RatingAggregate {
  count: number;
  avgFood: number | null;
  avgService: number | null;
  avgValue: number | null;
  avgNoise: number | null;
  avgOverall: number | null;
}

export interface ReviewItem {
  id: number;
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
export class RestaurantsService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/restaurants';

  getAll(cityId?: number, search?: string): Observable<Restaurant[]> {
    const params: Record<string, string> = {};
    if (cityId) params['cityId'] = String(cityId);
    if (search) params['search'] = search;
    return this.http.get<Restaurant[]>(this.base, { params });
  }

  getOne(id: number): Observable<Restaurant> {
    return this.http.get<Restaurant>(`${this.base}/${id}`);
  }

  create(payload: CreateRestaurantPayload): Observable<Restaurant> {
    return this.http.post<Restaurant>(this.base, payload);
  }

  update(id: number, payload: UpdateRestaurantPayload): Observable<Restaurant> {
    return this.http.patch<Restaurant>(`${this.base}/${id}`, payload);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }

  addPhoto(restaurantId: number, file: File): Observable<RestaurantPhoto> {
    const form = new FormData();
    form.append('photo', file);
    return this.http.post<RestaurantPhoto>(`${this.base}/${restaurantId}/photos`, form);
  }

  deletePhoto(restaurantId: number, photoId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${restaurantId}/photos/${photoId}`);
  }

  diagnose(id: number): Observable<unknown> {
    return this.http.get(`${this.base}/${id}/enrich/diagnose`);
  }

  bulkEnrich(): Observable<{ started: boolean; total: number }> {
    return this.http.post<{ started: boolean; total: number }>(`${this.base}/enrich/bulk`, {});
  }

  enrich(id: number): Observable<{ placeFound: boolean; description: string | null; phone: string | null; website: string | null; photoAdded: boolean; restaurant: Restaurant }> {
    return this.http.post<{ placeFound: boolean; description: string | null; phone: string | null; website: string | null; photoAdded: boolean; restaurant: Restaurant }>(`${this.base}/${id}/enrich`, {});
  }

  importFacebook(file: File, cityId: number): Observable<ImportResult> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ImportResult>(`${this.base}/import/facebook?cityId=${cityId}`, form);
  }

  getRatings(restaurantId: number): Observable<RatingsResponse> {
    return this.http.get<RatingsResponse>(`${this.base}/${restaurantId}/ratings`);
  }

  submitRating(restaurantId: number, payload: CreateRatingPayload): Observable<unknown> {
    return this.http.post(`${this.base}/${restaurantId}/ratings`, payload);
  }

  googleMapsUrl(restaurant: Restaurant): string | null {
    if (restaurant.lat && restaurant.lng) {
      return `https://www.google.com/maps?q=${restaurant.lat},${restaurant.lng}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.address)}`;
  }
}
