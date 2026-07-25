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
    const cities = this.cities();
    const subdomain = window.location.hostname.match(/^([a-z0-9-]+)\./)?.[1]?.toLowerCase();
    const bySubdomain = subdomain
      ? cities.find((c) => c.subdomain.toLowerCase() === subdomain)
      : undefined;
    if (bySubdomain) return bySubdomain;
    // Root-domain / single-region fork: the host carries no chapter subdomain
    // (the app is served straight from the apex, e.g. sons.example.com with no
    // city prefix), so fall back to the sole active city when there's exactly
    // one. The public /cities endpoint already returns active cities only.
    if (cities.length === 1) return cities[0];
    return undefined;
  });

  // True for a single-region fork — used to hide the city selector/filter,
  // which is meaningless when there's nothing to switch between. Also true
  // before the list loads (0 cities), which is fine: the filters it gates
  // have nothing to show until the list arrives anyway.
  readonly isSingleCity = computed<boolean>(() => this.cities().length <= 1);

  constructor() {
    this.http.get<City[]>('/api/v1/cities').subscribe((cities) => this.cities.set(cities));
  }
}
