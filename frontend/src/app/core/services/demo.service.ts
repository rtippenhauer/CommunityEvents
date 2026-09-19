import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface DemoRequestResponse {
  message: string;
}

export interface DemoConfirmResponse {
  /** The new community's absolute URL, on a generated host. */
  url: string;
  expiresAt: string;
}

/**
 * Asking for, and confirming, an ephemeral demo community (v2-14).
 *
 * Both calls are unauthenticated and both run against the root tenant's host:
 * the demo they concern has no host until it has been created.
 */
@Injectable({ providedIn: 'root' })
export class DemoService {
  private readonly http = inject(HttpClient);

  requestDemo(fullName: string, email: string, password: string): Observable<DemoRequestResponse> {
    return this.http.post<DemoRequestResponse>('/api/v1/demo/request', {
      fullName,
      email,
      password,
    });
  }

  confirmDemo(token: string): Observable<DemoConfirmResponse> {
    return this.http.get<DemoConfirmResponse>(
      `/api/v1/demo/confirm?token=${encodeURIComponent(token)}`,
    );
  }
}
