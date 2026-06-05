import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface RestaurantPhoto {
  id: number;
  filePath: string;
  fileName: string;
  sortOrder: number;
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
}

export interface CreateRestaurantPayload {
  name: string;
  address: string;
  phone?: string;
  websiteUrl?: string;
  description?: string;
  cityId: number;
}

export interface UpdateRestaurantPayload extends Partial<CreateRestaurantPayload> {
  isActive?: boolean;
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

  googleMapsUrl(restaurant: Restaurant): string | null {
    if (restaurant.lat && restaurant.lng) {
      return `https://www.google.com/maps?q=${restaurant.lat},${restaurant.lng}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(restaurant.address)}`;
  }
}
