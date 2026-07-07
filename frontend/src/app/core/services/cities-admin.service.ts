import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AdminCity {
  id: number;
  name: string;
  subdomain: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreateCityPayload {
  name: string;
  subdomain: string;
  isActive?: boolean;
}

export interface UpdateCityPayload extends Partial<CreateCityPayload> {}

@Injectable({ providedIn: 'root' })
export class CitiesAdminService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/admin/cities';

  getAll(): Observable<AdminCity[]> {
    return this.http.get<AdminCity[]>(this.base);
  }

  create(payload: CreateCityPayload): Observable<AdminCity> {
    return this.http.post<AdminCity>(this.base, payload);
  }

  update(id: number, payload: UpdateCityPayload): Observable<AdminCity> {
    return this.http.patch<AdminCity>(`${this.base}/${id}`, payload);
  }
}
