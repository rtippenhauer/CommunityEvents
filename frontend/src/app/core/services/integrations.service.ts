import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface MuseSettings {
  sharePrivateVenues: boolean;
  /** This community's slug, which its non-person accounts are addressed at. */
  communitySlug: string;
}

/** A token as the screen may know it: a prefix and whether it works. */
export interface ApiTokenRow {
  id: number;
  prefix: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  /** Unrevoked and unexpired. Derived by the API, never stored. */
  live: boolean;
}

export interface IntegrationAccount {
  id: number;
  fullName: string;
  email: string;
  role: string;
  status: string;
  createdAt: string;
  tokens: ApiTokenRow[];
}

/**
 * The plaintext token, which exists only in this response.
 *
 * There is no endpoint that returns it again: only the SHA-256 is stored, so a
 * lost token is reissued rather than recovered. The screen has to treat this
 * value as the one chance to copy it.
 */
export interface IssuedToken {
  token: string;
  prefix: string;
  expiresAt: string;
}

/**
 * Integration accounts and their bearer tokens (v2-29).
 *
 * A community's own, under `admin/` -- its admin creates the account, issues
 * the token and points their own Muse at it, with no operator involved.
 */
@Injectable({ providedIn: 'root' })
export class IntegrationsService {
  private readonly http = inject(HttpClient);

  list(): Observable<IntegrationAccount[]> {
    return this.http.get<IntegrationAccount[]>('/api/v1/admin/integrations');
  }

  createAccount(name: string): Observable<IntegrationAccount> {
    return this.http.post<IntegrationAccount>('/api/v1/admin/integrations', { name });
  }

  /** Mints a token, revoking every other live one for that account. */
  issueToken(userId: number): Observable<IssuedToken> {
    return this.http.post<IssuedToken>(`/api/v1/admin/integrations/${userId}/tokens`, {});
  }

  /** What this community lets Muse publish to Facebook. */
  museSettings(): Observable<MuseSettings> {
    return this.http.get<MuseSettings>('/api/v1/admin/integrations/muse-settings');
  }

  setMuseSettings(sharePrivateVenues: boolean): Observable<MuseSettings> {
    return this.http.patch<MuseSettings>('/api/v1/admin/integrations/muse-settings', {
      sharePrivateVenues,
    });
  }

  /** Which automation an account acts as; `automation` disables its token. */
  setRole(userId: number, role: 'muse' | 'automation'): Observable<IntegrationAccount> {
    return this.http.patch<IntegrationAccount>(
      `/api/v1/admin/integrations/${userId}/role`,
      { role },
    );
  }

  revokeToken(tokenId: number): Observable<void> {
    return this.http.delete<void>(`/api/v1/admin/integrations/tokens/${tokenId}`);
  }
}
