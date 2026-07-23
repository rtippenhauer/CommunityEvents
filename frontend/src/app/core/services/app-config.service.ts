import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export type LegalConfigKey = 'legal_terms_html' | 'legal_privacy_html' | 'about_story_html';

export interface LegalConfigItem {
  configKey: LegalConfigKey;
  configValue: string;
  updatedAt: string;
}

@Injectable({ providedIn: 'root' })
export class AppConfigService {
  private readonly http = inject(HttpClient);

  // ── Public ────────────────────────────────────────────────────────────────

  getValue(key: LegalConfigKey): Observable<string> {
    return this.http
      .get<{ value: string }>(`/api/v1/config/${key}`)
      .pipe(map((res) => res.value));
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  getLegalConfig(): Observable<LegalConfigItem[]> {
    return this.http.get<LegalConfigItem[]>('/api/v1/admin/config/legal');
  }

  updateValue(key: LegalConfigKey, value: string): Observable<LegalConfigItem> {
    return this.http.patch<LegalConfigItem>(`/api/v1/admin/config/${key}`, { value });
  }
}
