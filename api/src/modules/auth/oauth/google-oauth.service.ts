import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Strategy, type Profile } from 'passport-google-oauth20';
import type { Request } from 'express';
import { TenantOAuthService } from '../../../common/tenant/tenant-oauth.service';
import { decodeOAuthState, encodeOAuthState, type OAuthState } from './oauth-state.util';

/**
 * Why a Google sign-in could not proceed. Each maps to a `reason` on the
 * frontend's `/auth/error` page, so they are a contract -- don't rename one
 * side only.
 */
export type GoogleFailure =
  | 'provider_not_offered'
  | 'invalid_state'
  | 'consent_denied'
  | 'exchange_failed';

export class GoogleOAuthError extends Error {
  /**
   * The community the flow started on, where it is known.
   *
   * Absent exactly when the failure happened before `state` verified -- which
   * is the only case where nothing trustworthy says whose sign-in this was. Any
   * later failure has a community, and its member should land on *its* error
   * page rather than on whichever community happens to own the callback host.
   */
  constructor(
    readonly reason: GoogleFailure,
    message?: string,
    readonly tenantId?: number,
  ) {
    super(message ?? reason);
    this.name = 'GoogleOAuthError';
  }
}

/**
 * Runs Google's OAuth dance with **the originating community's own app**
 * (REQ-TENANT-01.9).
 *
 * `GoogleStrategy` used to be a singleton built once at module init from
 * `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`. It cannot be, now that the client
 * id and secret are chosen per request from the resolved tenant -- and mutating
 * one shared strategy's credentials per request would be a race between two
 * concurrent sign-ins on different communities, which is the kind of bug that
 * only appears under load and logs somebody into the wrong place. So a strategy
 * is constructed per request and thrown away, and Passport's global registry is
 * not involved at all.
 *
 * **The strategy's only job here is the token exchange.** Its verify callback
 * hands the profile straight back; finding or creating the member happens in
 * the caller, inside `runWithTenant`. In v1 the identity work lived in
 * `validate()`, which is what made the tenant context wrong -- the callback
 * resolves to the root tenant because the root host is where it lands, while
 * the member belongs to the community the flow started from.
 */
@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tenantOAuth: TenantOAuthService,
  ) {}

  /**
   * The single registered redirect URI (REQ-TENANT-01.8).
   *
   * Deliberately `APP_URL` and not `baseUrlFor()`: every community's callback
   * terminates on this one host, which is the whole reason a new community does
   * not require an operator to edit Google's console before its members can log
   * in. This is one of the three places `APP_URL` legitimately survives v2-6.
   */
  private callbackUrl(): string {
    return `${this.config.getOrThrow<string>('APP_URL')}/api/v1/auth/google/callback`;
  }

  /**
   * Where to send a member who pressed "Continue with Google" on `tenantId`.
   *
   * Throws `provider_not_offered` when the community has registered no app --
   * the login page should not have shown the button, but the route is reachable
   * directly and a community that switched Google off must not be signed into
   * through somebody else's app.
   */
  async authorizationUrl(
    req: Request,
    tenantId: number,
    inviteToken?: string,
  ): Promise<string> {
    const credentials = await this.tenantOAuth.googleCredentials(tenantId);
    if (!credentials) {
      throw new GoogleOAuthError('provider_not_offered');
    }

    const state = encodeOAuthState(
      { tenantId, inviteToken },
      this.config.getOrThrow<string>('JWT_SECRET'),
    );

    const outcome = await this.run(credentials, req, { state });
    if (outcome.type !== 'redirect') {
      throw new GoogleOAuthError('exchange_failed', `Expected a redirect, got ${outcome.type}`);
    }
    return outcome.url;
  }

  /**
   * Verifies the callback and exchanges the code for a profile.
   *
   * The state is verified **before** any credential is loaded, because the
   * state is what says which community's secret to exchange with: a forged
   * state would be credential confusion on top of a cross-tenant session.
   */
  async completeCallback(req: Request): Promise<{ state: OAuthState; profile: Profile }> {
    const query = req.query as { state?: string; error?: string };

    // The member pressed Cancel on the consent screen. Not an error condition,
    // and telling them "exchange failed" would be a lie.
    if (query.error) {
      throw new GoogleOAuthError('consent_denied', query.error);
    }

    const state = decodeOAuthState(query.state, this.config.getOrThrow<string>('JWT_SECRET'));
    if (!state) {
      this.logger.warn('Google callback carried a state that did not verify; refusing it.');
      throw new GoogleOAuthError('invalid_state');
    }

    const credentials = await this.tenantOAuth.googleCredentials(state.tenantId);
    if (!credentials) {
      // The community switched Google off, or its credentials were cleared,
      // while this flow was in the air.
      throw new GoogleOAuthError('provider_not_offered', undefined, state.tenantId);
    }

    const outcome = await this.run(credentials, req, {});
    if (outcome.type !== 'success') {
      throw new GoogleOAuthError('exchange_failed', outcome.type, state.tenantId);
    }
    return { state, profile: outcome.profile };
  }

  /**
   * Drives one throwaway Passport strategy to whichever of its four terminal
   * callbacks it reaches.
   *
   * Passport's own framework normally assigns `success`/`fail`/`redirect`/
   * `error` onto the strategy per request; since the strategy here is already
   * per request, assigning them directly is the same thing with less
   * indirection -- and it keeps the outcome a value this service can act on
   * rather than a response somebody else already wrote.
   */
  private run(
    credentials: { clientId: string; clientSecret: string },
    req: Request,
    options: Record<string, unknown>,
  ): Promise<
    | { type: 'redirect'; url: string }
    | { type: 'success'; profile: Profile }
    | { type: 'failure' }
  > {
    return new Promise((resolve, reject) => {
      const strategy = new Strategy(
        {
          clientID: credentials.clientId,
          clientSecret: credentials.clientSecret,
          callbackURL: this.callbackUrl(),
          scope: ['email', 'profile'],
        },
        // Identity work deliberately does not happen here -- see the class
        // comment. Handing the profile back is the whole verify step.
        (_accessToken: string, _refreshToken: string, profile: Profile, done) => {
          done(null, profile);
        },
      );

      Object.assign(strategy, {
        redirect: (url: string) => resolve({ type: 'redirect', url }),
        success: (profile: Profile) => resolve({ type: 'success', profile }),
        fail: () => resolve({ type: 'failure' }),
        error: (err: Error) => reject(err),
      });

      try {
        strategy.authenticate(req, options);
      } catch (err) {
        reject(err as Error);
      }
    });
  }
}
