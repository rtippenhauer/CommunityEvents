import { Injectable, inject } from '@angular/core';
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

  getLinks(): Observable<MerchLinks> {
    return this.http.get<MerchLinks>(this.base);
  }

  getConfig(): Observable<MerchConfig> {
    return this.http.get<MerchConfig>(`${this.base}/admin/config`);
  }

  updateConfig(payload: UpdateMerchConfigPayload): Observable<MerchConfig> {
    return this.http.patch<MerchConfig>(`${this.base}/admin/config`, payload);
  }
}
