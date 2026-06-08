import { Injectable, signal, computed } from '@angular/core';

export type CitySlug = 'cincinnati' | 'dayton';

export interface City {
  id: number;
  name: string;
  slug: CitySlug;
}

const CITIES: City[] = [
  { id: 1, name: 'Cincinnati', slug: 'cincinnati' },
  { id: 2, name: 'Dayton', slug: 'dayton' },
];

function detectSubdomain(): CitySlug {
  const match = typeof window !== 'undefined'
    ? window.location.hostname.match(/^([a-z]+)\./)
    : null;
  const sub = match?.[1];
  return sub === 'dayton' ? 'dayton' : 'cincinnati';
}

@Injectable({ providedIn: 'root' })
export class CityService {
  readonly cities = CITIES;
  readonly selected = signal<CitySlug>(detectSubdomain());

  readonly selectedCity = computed<City>(
    () => CITIES.find((c) => c.slug === this.selected()) ?? CITIES[0],
  );

  select(slug: CitySlug): void {
    this.selected.set(slug);
  }
}
