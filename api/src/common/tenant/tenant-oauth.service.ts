import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { currentTenantId } from './tenant-store';

/** One provider's app credentials, as registered by a community's operator. */
export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/** Which sign-in methods a community offers. Email/password is not optional. */
export interface OfferedProviders {
  google: boolean;
  facebook: boolean;
}

/**
 * A community's own OAuth app credentials (REQ-TENANT-01.9).
 *
 * NULL means **that provider is switched off for that community**, which then
 * offers email/password only. There is no platform-wide fallback app: a
 * community that has not registered its own app has no relationship with Google
 * or Meta, and signing its members in through the platform's app would make the
 * platform -- not the community -- the party those members granted consent to.
 * (REQ-TENANT-01.1 originally read these columns the other way round. That was
 * reversed on 2026-08-14; the columns are unchanged, their meaning is not.)
 *
 * Lives beside `TenantResolutionService` rather than in `AuthModule` because it
 * is knowledge about the tenant registry, and because the branding payload has
 * to answer "what does this community offer?" on every app load. Putting it in
 * `AuthModule` would make `AppConfigModule` depend on the auth graph to render
 * a login page.
 *
 * **`tenants` is a global model**, so none of these reads are tenant-scoped and
 * every one of them takes an explicit id. The secrets are decrypted on the way
 * out by the encryption extension (v2-7) -- nothing here handles ciphertext.
 */
@Injectable()
export class TenantOAuthService {
  private readonly logger = new Logger(TenantOAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Which providers this community offers, for the login page.
   *
   * **Selects the id columns only, never the secrets.** This runs on every app
   * load as part of the branding payload, and a credential that is not read is
   * a credential that cannot be logged, cached or accidentally serialised into
   * a public response. It is answerable from the ids alone because the write
   * path stores and clears each pair together -- see `setCredentials`.
   */
  async offeredProviders(tenantId?: number): Promise<OfferedProviders> {
    const id = tenantId ?? currentTenantId() ?? undefined;
    if (id === undefined) {
      // Not throwing: the caller is rendering a login page, and "no social
      // buttons" is a usable page where a 500 is not.
      this.logger.error('offeredProviders called with no tenant; reporting none offered.');
      return { google: false, facebook: false };
    }

    const tenant = await this.prisma.tenants.findUnique({
      where: { id },
      select: { googleClientId: true, facebookAppId: true },
    });

    return {
      google: !!tenant?.googleClientId,
      facebook: !!tenant?.facebookAppId,
    };
  }

  /** The community's Facebook app id, or null. Public — it appears in the SDK call. */
  async facebookAppId(tenantId?: number): Promise<string | null> {
    const id = tenantId ?? currentTenantId() ?? undefined;
    if (id === undefined) return null;

    const tenant = await this.prisma.tenants.findUnique({
      where: { id },
      select: { facebookAppId: true },
    });
    return tenant?.facebookAppId ?? null;
  }

  /**
   * The community's Google credentials, or null if it does not offer Google.
   *
   * Returns null rather than a half-filled pair when only one column is set:
   * `setCredentials` writes both or neither, so a half-filled row is a hand-
   * edited database rather than a supported state, and starting an OAuth flow
   * with a client id and no secret fails at the token exchange -- after the
   * member has already seen a consent screen.
   */
  async googleCredentials(tenantId: number): Promise<OAuthCredentials | null> {
    const tenant = await this.prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { googleClientId: true, googleClientSecret: true },
    });
    return this.pair(tenantId, 'Google', tenant?.googleClientId, tenant?.googleClientSecret);
  }

  /** The community's Meta credentials, or null if it does not offer Facebook. */
  async facebookCredentials(tenantId: number): Promise<OAuthCredentials | null> {
    const tenant = await this.prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { facebookAppId: true, facebookAppSecret: true },
    });
    return this.pair(tenantId, 'Facebook', tenant?.facebookAppId, tenant?.facebookAppSecret);
  }

  private pair(
    tenantId: number,
    provider: string,
    clientId: string | null | undefined,
    clientSecret: string | null | undefined,
  ): OAuthCredentials | null {
    if (!clientId || !clientSecret) {
      if (clientId || clientSecret) {
        this.logger.error(
          `Tenant ${tenantId} has only half of its ${provider} credentials set. ` +
            `Treating the provider as switched off; set both columns or neither.`,
        );
      }
      return null;
    }
    return { clientId, clientSecret };
  }
}
