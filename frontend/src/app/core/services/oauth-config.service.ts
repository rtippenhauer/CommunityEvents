import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/** One provider's app, as the admin screen is allowed to see it. */
export interface OAuthProviderConfig {
  /**
   * Public — it travels in every authorization URL — so it is shown, not
   * masked. An admin who cannot see which app is configured cannot tell a
   * stale one from the right one.
   */
  clientId: string | null;
  /** The secret itself never leaves the server. See the API's view type. */
  secretSet: boolean;
  /** Whether the community currently offers this provider. */
  enabled: boolean;
}

export interface OAuthConfig {
  google: OAuthProviderConfig;
  facebook: OAuthProviderConfig;
  /** The one redirect URI to register, identical for every community here. */
  googleRedirectUri: string;
}

/** Sending no `clientId` switches the provider off. */
export interface OAuthProviderUpdate {
  clientId?: string;
  clientSecret?: string;
}

/**
 * This community's own OAuth apps (REQ-TENANT-01.9).
 *
 * Every call acts on the community serving the page — the API takes the tenant
 * from the request's host and there is no id to pass, deliberately: an
 * endpoint that accepted one would let a community's admin edit another's.
 */
@Injectable({ providedIn: 'root' })
export class OAuthConfigService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/v1/admin/oauth';

  get(): Observable<OAuthConfig> {
    return this.http.get<OAuthConfig>(this.base);
  }

  setGoogle(update: OAuthProviderUpdate): Observable<OAuthConfig> {
    return this.http.put<OAuthConfig>(`${this.base}/google`, update);
  }

  setFacebook(update: OAuthProviderUpdate): Observable<OAuthConfig> {
    return this.http.put<OAuthConfig>(`${this.base}/facebook`, update);
  }
}
