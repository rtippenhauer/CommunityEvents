import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { TenantOAuthService } from '../../../common/tenant/tenant-oauth.service';

const GRAPH = 'https://graph.facebook.com';

/** The Graph profile fields this application actually consumes. */
export interface FacebookProfile {
  id: string;
  name: string;
  email?: string;
  picture?: { data?: { url?: string } };
  link?: string;
}

/**
 * Verifies Facebook access tokens against **the community's own Meta app**
 * (REQ-TENANT-01.9).
 *
 * Facebook is materially easier than Google here, and it is worth being
 * explicit about why: it is not a Passport strategy at all. The browser obtains
 * an access token through Meta's JS SDK and posts it here, so the per-community
 * part is mostly *which app id the page initialises the SDK with* -- which
 * already comes from the branding payload.
 *
 * **What is not merely a rename is the check below.** The inherited code took
 * the client's access token and called `/me` with it. That authenticates the
 * token, but says nothing about which app minted it: any valid Facebook token,
 * from any app anywhere, would resolve to a profile and sign that person in.
 * With one deployment-wide app that was a latent problem; with per-community
 * apps it is a live one, because a token from community A's app would otherwise
 * be accepted by community B. `debug_token` is what ties a token back to the
 * app that issued it, and this service refuses anything it cannot.
 */
@Injectable()
export class FacebookOAuthService {
  private readonly logger = new Logger(FacebookOAuthService.name);

  constructor(private readonly tenantOAuth: TenantOAuthService) {}

  /**
   * The community's app secret, for verifying a `signed_request` Meta posts to
   * the data-deletion callback. Null when the community offers no Facebook.
   */
  async appSecretFor(tenantId: number): Promise<string | null> {
    const credentials = await this.tenantOAuth.facebookCredentials(tenantId);
    return credentials?.clientSecret ?? null;
  }

  /**
   * Confirms the token was minted by this community's app, then returns the
   * profile behind it.
   *
   * Throws rather than returning null: every caller is an authentication path,
   * and there is no sensible way to continue without a verified identity.
   */
  async profileFor(tenantId: number, accessToken: string): Promise<FacebookProfile> {
    const credentials = await this.tenantOAuth.facebookCredentials(tenantId);
    if (!credentials) {
      throw new UnauthorizedException({
        message: 'This community does not offer Facebook sign-in.',
        reason: 'provider_not_offered',
      });
    }

    // The app access token is the id and secret joined by a pipe -- Meta's own
    // documented form for a server-to-server call that needs no user.
    const appAccessToken = `${credentials.clientId}|${credentials.clientSecret}`;
    const debugUrl =
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(accessToken)}` +
      `&access_token=${encodeURIComponent(appAccessToken)}`;

    const debugRes = await fetch(debugUrl);
    if (!debugRes.ok) {
      this.logger.warn(`Facebook rejected a token inspection for tenant ${tenantId}.`);
      throw new UnauthorizedException('Invalid Facebook token');
    }

    const debug = (await debugRes.json()) as {
      data?: { app_id?: string; is_valid?: boolean; user_id?: string };
    };

    if (!debug.data?.is_valid) {
      throw new UnauthorizedException('Invalid Facebook token');
    }

    // The check this service exists for. A token from another community's app
    // is a perfectly valid Facebook token; it is just not one this community
    // asked for.
    if (debug.data.app_id !== credentials.clientId) {
      this.logger.warn(
        `A Facebook token issued by app ${debug.data.app_id} was presented to tenant ` +
          `${tenantId}, whose app is ${credentials.clientId}. Refusing it.`,
      );
      throw new UnauthorizedException('Invalid Facebook token');
    }

    const profileRes = await fetch(
      `${GRAPH}/me?fields=id,name,email,picture.type(large),link&access_token=${encodeURIComponent(accessToken)}`,
    );
    if (!profileRes.ok) throw new UnauthorizedException('Invalid Facebook token');

    const profile = (await profileRes.json()) as FacebookProfile;

    // Belt and braces: `/me` resolves whoever the token belongs to, and
    // debug_token already told us who that is. A mismatch would mean the two
    // calls disagreed, which should be impossible and must never be papered
    // over in an authentication path.
    if (debug.data.user_id && profile.id !== debug.data.user_id) {
      throw new UnauthorizedException('Invalid Facebook token');
    }

    return profile;
  }
}
