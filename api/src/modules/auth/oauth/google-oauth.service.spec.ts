import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Request } from 'express';
import type { TenantOAuthService } from '../../../common/tenant/tenant-oauth.service';

/**
 * Shared with the module mock below, so it has to exist before the mock factory
 * runs -- `vi.mock` is hoisted above the imports, and a plain `const` here would
 * still be in its temporal dead zone when the factory reaches it.
 *
 * `constructedWith` collects every `callbackURL` a Strategy has been built
 * with, in order: the two OAuth legs each build one, and the whole point of the
 * assertions below is that they agree.
 */
const strategyState = vi.hoisted(() => ({
  constructedWith: [] as string[],
  /** What the next `authenticate()` should do: start the flow, or finish it. */
  nextOutcome: 'redirect' as 'redirect' | 'success',
}));

vi.mock('passport-google-oauth20', () => ({
  Strategy: class {
    constructor(options: { callbackURL: string }) {
      strategyState.constructedWith.push(options.callbackURL);
    }
    authenticate(this: Record<string, (arg: unknown) => void>) {
      if (strategyState.nextOutcome === 'redirect') {
        this.redirect('https://accounts.google.com/o/oauth2/v2/auth?client_id=cid');
      } else {
        this.success({ id: 'g-1', emails: [{ value: 'a@example.com' }] });
      }
    }
  },
}));

import { GoogleOAuthService } from './google-oauth.service';
import { encodeOAuthState } from './oauth-state.util';

/**
 * Which redirect URI a community's Google flow uses (v2-12).
 *
 * The failure this guards against is specific and unhelpfully reported: Google
 * matches `redirect_uri` at the token exchange as well as at the authorization
 * redirect, so a value that differs between the two legs fails with a
 * `redirect_uri_mismatch` that names neither the value sent nor the one
 * expected. Both legs derive it independently -- leg one from `req.tenant`, leg
 * two from the signed `state` -- which is exactly the shape that drifts.
 */
describe('GoogleOAuthService — which redirect URI each leg sends', () => {
  const JWT_SECRET = 'test-secret-for-state-signing';
  const APP_URL = 'https://www.communityeventsproject.com';

  const DEPLOYMENT_URI = `${APP_URL}/api/v1/auth/google/callback`;
  const OWN_HOST_URI = 'https://dinnerbears.com/api/v1/auth/google/callback';

  const config = {
    get: (key: string, fallback?: string) =>
      ({ APP_URL, JWT_SECRET })[key as 'APP_URL' | 'JWT_SECRET'] ?? fallback,
    getOrThrow: (key: string) => ({ APP_URL, JWT_SECRET })[key as 'APP_URL' | 'JWT_SECRET'],
  } as unknown as ConfigService;

  /**
   * Tenant 2 is on a subdomain of the deployment and gets the one registered
   * URI; tenant 3 owns its domain and gets its own host. The real derivation
   * lives in TenantOAuthService and has its own tests -- what matters here is
   * that both legs ask for it and neither substitutes its own answer.
   */
  const tenantOAuth = {
    googleCredentials: async () => ({ clientId: 'cid', clientSecret: 'secret' }),
    googleRedirectUri: async (tenantId: number) =>
      tenantId === 3 ? OWN_HOST_URI : DEPLOYMENT_URI,
  } as unknown as TenantOAuthService;

  const make = () => new GoogleOAuthService(config, tenantOAuth);

  /** A callback request carrying a genuinely signed state for `tenantId`. */
  const callbackReq = (tenantId: number): Request =>
    ({
      query: { state: encodeOAuthState({ tenantId }, JWT_SECRET), code: 'auth-code' },
      headers: {},
    }) as unknown as Request;

  beforeEach(() => {
    strategyState.constructedWith.length = 0;
    strategyState.nextOutcome = 'redirect';
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('sends a community on a subdomain to the deployment’s one registered URI', async () => {
    await make().authorizationUrl({ headers: {} } as Request, 2);
    expect(strategyState.constructedWith).toEqual([DEPLOYMENT_URI]);
  });

  it('sends a community on its own domain to its own host', async () => {
    await make().authorizationUrl({ headers: {} } as Request, 3);
    expect(strategyState.constructedWith).toEqual([OWN_HOST_URI]);
  });

  it('uses the same URI on both legs for a community on a subdomain', async () => {
    const svc = make();
    await svc.authorizationUrl({ headers: {} } as Request, 2);

    strategyState.nextOutcome = 'success';
    await svc.completeCallback(callbackReq(2));

    expect(strategyState.constructedWith).toHaveLength(2);
    expect(strategyState.constructedWith[0]).toBe(strategyState.constructedWith[1]);
    expect(strategyState.constructedWith[1]).toBe(DEPLOYMENT_URI);
  });

  it('uses the same URI on both legs for a community on its own domain', async () => {
    // The case v2-12 adds, and the one with two moving parts: leg two takes the
    // tenant from the signed state rather than from the host it landed on, so
    // it must reach the same answer leg one did from `req.tenant`.
    const svc = make();
    await svc.authorizationUrl({ headers: {} } as Request, 3);

    strategyState.nextOutcome = 'success';
    await svc.completeCallback(callbackReq(3));

    expect(strategyState.constructedWith).toHaveLength(2);
    expect(strategyState.constructedWith[0]).toBe(strategyState.constructedWith[1]);
    expect(strategyState.constructedWith[1]).toBe(OWN_HOST_URI);
  });

  it('takes the callback leg’s URI from the state, not from the host it landed on', async () => {
    // The whole cross-host case: an own-domain community's callback verified
    // here must not be exchanged against the deployment's URI just because
    // this process also serves the deployment.
    strategyState.nextOutcome = 'success';
    await make().completeCallback(callbackReq(3));
    expect(strategyState.constructedWith).toEqual([OWN_HOST_URI]);
  });
});
