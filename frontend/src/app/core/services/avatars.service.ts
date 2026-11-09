import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Avatar {
  id: number;
  path: string;
  label: string;
}

@Injectable({ providedIn: 'root' })
export class AvatarsService {
  private readonly http = inject(HttpClient);

  // This community's presets, for the profile avatar picker. Requires a
  // session as of v2-47 and serves only the host community's rows -- it was
  // an unguarded route over a table every community shared.
  getManifest(): Observable<Avatar[]> {
    return this.http.get<Avatar[]>('/api/v1/avatars/manifest');
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  listAdmin(): Observable<Avatar[]> {
    return this.http.get<Avatar[]>('/api/v1/admin/avatars');
  }

  upload(file: File, label: string): Observable<Avatar> {
    const form = new FormData();
    form.append('image', file);
    form.append('label', label);
    return this.http.post<Avatar>('/api/v1/admin/avatars', form);
  }

  updateLabel(id: number, label: string): Observable<Avatar> {
    return this.http.patch<Avatar>(`/api/v1/admin/avatars/${id}`, { label });
  }

  remove(id: number): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`/api/v1/admin/avatars/${id}`);
  }
}
