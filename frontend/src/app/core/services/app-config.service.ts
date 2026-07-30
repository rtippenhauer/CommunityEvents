import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export type LegalConfigKey =
  | 'legal_terms_html'
  | 'legal_privacy_html'
  | 'about_story_html'
  | 'home_hero_html'
  | 'home_howitworks_html';

export type SiteSettingKey =
  | 'location_privacy_default'
  | 'event_cadence_weekday'
  | 'event_cadence_time'
  | 'home_show_stats'
  | 'brand_name'
  | 'brand_tagline'
  | 'theme_color_primary'
  | 'theme_color_accent'
  | 'theme_color_background'
  | 'brand_logo_url'
  | 'brand_splash_url'
  | 'brand_icon_url'
  | 'brand_story_url'
  | 'term_location_singular'
  | 'term_location_plural'
  | 'term_dinner_singular'
  | 'term_dinner_plural'
  | 'term_points'
  | 'feature_ratings'
  | 'feature_ratings_residences'
  | 'feature_leaderboard'
  | 'feature_merch'
  | 'feature_members'
  | 'feature_require_membership';

export type BrandImageSlot = 'logo' | 'splash' | 'icon' | 'story';

export interface LegalConfigItem {
  configKey: LegalConfigKey;
  configValue: string;
  updatedAt: string;
}

export interface SiteSettingItem {
  configKey: SiteSettingKey;
  configValue: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly http = inject(HttpClient);

  // ── Public ────────────────────────────────────────────────────────────────

  getValue(key: LegalConfigKey | SiteSettingKey): Observable<string> {
    return this.http
      .get<{ value: string }>(`/api/v1/config/${key}`)
      .pipe(map((res) => res.value));
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  getLegalConfig(): Observable<LegalConfigItem[]> {
    return this.http.get<LegalConfigItem[]>('/api/v1/admin/config/legal');
  }

  getSiteSettings(): Observable<SiteSettingItem[]> {
    return this.http.get<SiteSettingItem[]>('/api/v1/admin/config/site-settings');
  }

  updateValue(key: LegalConfigKey | SiteSettingKey, value: string): Observable<LegalConfigItem> {
    return this.http.patch<LegalConfigItem>(`/api/v1/admin/config/${key}`, { value });
  }

  // Saves many keys in a single request — use this instead of calling
  // updateValue() in a loop/forkJoin, which fires one PATCH per key and can
  // trip the global write-rate-limit (30 writes/60s/IP) on a double-click or
  // retry once a form has more than a handful of fields.
  updateValues(entries: Array<{ key: LegalConfigKey | SiteSettingKey; value: string }>): Observable<void> {
    return this.http.patch<void>('/api/v1/admin/config/bulk', { entries });
  }

  uploadBrandImage(slot: BrandImageSlot, file: File): Observable<{ value: string }> {
    const form = new FormData();
    form.append('image', file);
    return this.http.post<{ value: string }>(`/api/v1/admin/config/branding/image/${slot}`, form);
  }

  resetBrandImage(slot: BrandImageSlot): Observable<{ value: string }> {
    return this.http.patch<{ value: string }>(
      `/api/v1/admin/config/branding/image/${slot}/reset`,
      {},
    );
  }
}
