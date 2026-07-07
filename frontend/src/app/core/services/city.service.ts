import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export interface City {
  id: number;
  name: string;
  subdomain: string;
}

@Injectable({ providedIn: 'root' })
export class CityService {
  private readonly http = inject(HttpClient);

  readonly cities = signal<City[]>([]);

  readonly currentCity = computed<City | undefined>(() => {
    const subdomain = window.location.hostname.match(/^([a-z0-9-]+)\./)?.[1]?.toLowerCase();
    if (!subdomain) return undefined;
    return this.cities().find((c) => c.subdomain.toLowerCase() === subdomain);
  });

  constructor() {
    this.http.get<City[]>('/api/v1/cities').subscribe((cities) => this.cities.set(cities));
  }
}
