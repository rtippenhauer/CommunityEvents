import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BrandConfigService } from './brand-config.service';

export interface City {
  id: number;
  name: string;
  /**
   * False for a city the community has retired.
   *
   * Only ever present on the extra entry `include` adds — the row's own
   * current value, kept in the list so a picker can show it rather than
   * rendering blank. Everything else the endpoint returns is active.
   */
  isActive?: boolean;
}

@Injectable({ providedIn: 'root' })
export class CityService {
  private readonly http = inject(HttpClient);
  private readonly brand = inject(BrandConfigService);

  readonly cities = signal<City[]>([]);

  /** Whether this community files anything under cities at all. */
  readonly enabled = computed<boolean>(() => this.brand.features().cities);

  /**
   * Hide the city controls when there is nothing to choose between — the
   * feature is off, or the community meets in one place.
   *
   * `currentCity` and the subdomain sniffing that produced it are gone with
   * v2-24: a city is a row, not a hostname, so there was never a city to read
   * off `window.location`. Nothing needs "the city we are on" any more; a
   * member's own city is on their profile and the filter is their preference
   * set.
   */
  readonly isSingleCity = computed<boolean>(() => !this.enabled() || this.cities().length <= 1);

  constructor() {
    this.load();
  }

  /** Reloads the list — called after an admin adds or retires one. */
  load(include?: number): void {
    const query = include === undefined ? '' : `?include=${include}`;
    this.http.get<City[]>(`/api/v1/cities${query}`).subscribe((cities) => this.cities.set(cities));
  }
}
