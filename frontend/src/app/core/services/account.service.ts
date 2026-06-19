import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ConnectedProviders {
  google: { email: string | null } | null;
  facebook: { email: string | null } | null;
  hasPassword: boolean;
  hasMultipleMethods: boolean;
}

export type DeletionStatus = 'pending' | 'completed' | 'not_found';

@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly base = '/api/v1';

  constructor(private readonly http: HttpClient) {}

  getConnectedProviders(): Observable<ConnectedProviders> {
    return this.http.get<ConnectedProviders>(`${this.base}/auth/providers`);
  }

  disconnectProvider(provider: 'google' | 'facebook'): Observable<void> {
    return this.http.delete<void>(`${this.base}/auth/providers/${provider}`);
  }

  deleteAccount(): Observable<void> {
    return this.http.delete<void>(`${this.base}/users/me`, {
      body: { confirm: 'DELETE' },
    });
  }

  getDeletionStatus(code: string): Observable<{ status: DeletionStatus }> {
    return this.http.get<{ status: DeletionStatus }>(
      `${this.base}/auth/facebook/deletion-status`,
      { params: { code } },
    );
  }
}
