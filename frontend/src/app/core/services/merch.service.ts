import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface MerchLinks {
  storeUrl: string | null;
  foundingBearProductUrl: string | null;
}

export interface MerchConfig {
  id: number;
  storeUrl: string | null;
  foundingBearProductUrl: string | null;
  updatedAt: string;
}

export interface UpdateMerchConfigPayload {
  storeUrl?: string | null;
  foundingBearProductUrl?: string | null;
}

@Injectable({ providedIn: 'root' })
export class MerchService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/merch';

  /** Cache of the current user's visible merch links, for nav-link visibility. */
  readonly links = signal<MerchLinks | null>(null);

  getLinks(): Observable<MerchLinks> {
    return this.http.get<MerchLinks>(this.base);
  }

  loadLinks(): void {
    this.getLinks().subscribe((links) => this.links.set(links));
  }

  getConfig(): Observable<MerchConfig> {
    return this.http.get<MerchConfig>(`${this.base}/admin/config`);
  }

  updateConfig(payload: UpdateMerchConfigPayload): Observable<MerchConfig> {
    return this.http.patch<MerchConfig>(`${this.base}/admin/config`, payload);
  }
}
