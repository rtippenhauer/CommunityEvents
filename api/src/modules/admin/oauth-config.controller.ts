import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import { TenantOAuthService } from '../../common/tenant/tenant-oauth.service';
import { UserRole } from '../../database/enums';
import { UpdateOAuthProviderDto } from './dto/update-oauth-provider.dto';
import type { users as User } from '@prisma/client';

/**
 * What the sign-in-providers screen is allowed to see.
 *
 * The client id is returned because it is genuinely public -- it travels in
 * every authorization URL, in plain sight in the member's address bar -- and an
 * admin who cannot see which app is configured cannot tell a stale one from the
 * right one. The secret is a boolean, for the reason set out in
 * `email-config.view.ts`: decrypting a credential at the database edge and
 * re-exporting it at the HTTP edge would undo the column encryption at the last
 * hop, putting it in an access log, a proxy buffer and a browser cache.
 */
interface OAuthProviderView {
  clientId: string | null;
  secretSet: boolean;
  /** Whether this community currently offers the provider at all. */
  enabled: boolean;
}

interface OAuthConfigView {
  google: OAuthProviderView;
  facebook: OAuthProviderView;
  /**
   * The redirect URI **this** community's operator has to register
   * (REQ-TENANT-01.8, per-community since v2-12). Returned rather than
   * documented because it is no longer the same for everyone and there is no
   * way to tell by looking: a community on a subdomain of this deployment
   * registers the deployment's one URI, and a community on its own domain
   * registers its own host. Pasting the other one is the commonest way to fail
   * this setup, and the provider rejects it with an error that names neither.
   */
  googleRedirectUri: string;
  /**
   * Whether this community is on a subdomain of the deployment, which is what
   * decides the URI above -- shown so an admin can see *why* they were given
   * the one they were given, rather than having to trust it.
   */
  onDeploymentDomain: boolean;
}

/**
 * Where a community registers its own OAuth apps (REQ-TENANT-01.9).
 *
 * **Guarded by `@Roles(ADMIN)` and acting only on `req.tenant`.** That pairing
 * is the whole access model: the credentials live on the `tenants` row, which
 * is a global model the scoping extension does not filter, so every read and
 * write here names the requesting community's id explicitly. This is the shape
 * of bug v2-9 was created to fix -- `/admin/email` was `@Roles(ADMIN)` over a
 * single global row, so any community's admin could rewrite the whole
 * deployment's sending credentials. Nothing in this file may take an id from
 * the caller.
 */
@Controller('admin/oauth')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class OAuthConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly tenantResolution: TenantResolutionService,
    private readonly tenantOAuth: TenantOAuthService,
  ) {}

  private tenantId(req: Request): number {
    const id = req.tenant?.id;
    if (!id) throw new Error('No community resolved for this request.');
    return id;
  }

  @Get()
  async get(@Req() req: Request): Promise<OAuthConfigView> {
    const tenant = await this.prisma.tenants.findUnique({
      where: { id: this.tenantId(req) },
      select: {
        googleClientId: true,
        googleClientSecret: true,
        facebookAppId: true,
        facebookAppSecret: true,
      },
    });

    // Taken from the one place that decides it, not derived again here.
    // An admin screen showing a different URI from the one the flow uses would
    // be worse than showing none -- it would send somebody to Google's console
    // to register a value guaranteed to mismatch.
    const tenantId = this.tenantId(req);
    const googleRedirectUri = await this.tenantOAuth.googleRedirectUri(tenantId);
    const onDeploymentDomain = await this.tenantResolution.isOnDeploymentDomain(tenantId);

    const view = (clientId?: string | null, secret?: string | null): OAuthProviderView => ({
      clientId: clientId ?? null,
      secretSet: !!secret,
      enabled: !!clientId && !!secret,
    });

    return {
      google: view(tenant?.googleClientId, tenant?.googleClientSecret),
      facebook: view(tenant?.facebookAppId, tenant?.facebookAppSecret),
      googleRedirectUri,
      onDeploymentDomain,
    };
  }

  /**
   * Sets or clears this community's Google app.
   *
   * **Both halves move together, always** -- enforced by the DTO, which
   * requires a secret whenever an id is present. A client id with no secret is
   * not a half-configured provider, it is a button that sends a member to a
   * consent screen and then fails the token exchange afterwards, and it is the
   * only state that would make `offeredProviders` (which reads the id alone, so
   * that a page load never touches a secret) tell the login page something
   * untrue.
   *
   * There is deliberately no "leave the secret blank to keep the stored one"
   * path. It reads as a convenience and is a trap: the secret cannot be shown
   * back, so the blank box looks identical whether you are keeping a secret or
   * forgetting to supply one, and the failure it produces lands at the token
   * exchange -- after the member has already granted consent. A credential of
   * exactly two fields has no meaningful partial update anyway: the only other
   * thing to edit is the id, and changing that is precisely when the old secret
   * stops applying.
   */
  @Put('google')
  async setGoogle(
    @Body() dto: UpdateOAuthProviderDto,
    @Req() req: Request,
    @CurrentUser() user: User,
  ): Promise<OAuthConfigView> {
    return this.update(req, user, 'google', dto);
  }

  /** Sets or clears this community's Meta app. See `setGoogle`. */
  @Put('facebook')
  async setFacebook(
    @Body() dto: UpdateOAuthProviderDto,
    @Req() req: Request,
    @CurrentUser() user: User,
  ): Promise<OAuthConfigView> {
    return this.update(req, user, 'facebook', dto);
  }

  private async update(
    req: Request,
    user: User,
    provider: 'google' | 'facebook',
    dto: UpdateOAuthProviderDto,
  ): Promise<OAuthConfigView> {
    const tenantId = this.tenantId(req);
    const clearing = !dto.clientId;

    const data =
      provider === 'google'
        ? {
            googleClientId: clearing ? null : dto.clientId,
            googleClientSecret: clearing ? null : dto.clientSecret,
          }
        : {
            facebookAppId: clearing ? null : dto.clientId,
            facebookAppSecret: clearing ? null : dto.clientSecret,
          };

    // The secrets are encrypted on the way in by the v2-7 extension; nothing
    // here handles ciphertext.
    await this.prisma.tenants.update({ where: { id: tenantId }, data });

    // Audited on this community, unlike a system admin's cross-community
    // actions: the actor is a member of it and the change is theirs to answer
    // for. The credential itself is deliberately absent from the metadata --
    // an audit row is somewhere a secret would sit indefinitely.
    await this.audit.log({
      userId: user.id,
      action: clearing ? 'oauth_provider_disabled' : 'oauth_provider_configured',
      entityType: 'tenant',
      entityId: tenantId,
      metadata: { provider },
    });

    return this.get(req);
  }
}
