import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
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
   * The one redirect URI to register with the provider, identical for every
   * community on this deployment (REQ-TENANT-01.8). Returned rather than
   * documented because the commonest way to fail this setup is to paste the
   * community's own host, which the provider will then reject.
   */
  googleRedirectUri: string;
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

    const view = (clientId?: string | null, secret?: string | null): OAuthProviderView => ({
      clientId: clientId ?? null,
      secretSet: !!secret,
      enabled: !!clientId && !!secret,
    });

    return {
      google: view(tenant?.googleClientId, tenant?.googleClientSecret),
      facebook: view(tenant?.facebookAppId, tenant?.facebookAppSecret),
      googleRedirectUri: `${this.config.getOrThrow<string>('APP_URL')}/api/v1/auth/google/callback`,
    };
  }

  /**
   * Sets or clears this community's Google app.
   *
   * **Both halves move together, always.** A client id with no secret is not a
   * half-configured provider, it is a button that sends a member to a consent
   * screen and then fails the token exchange afterwards -- and it is the only
   * state that would make `offeredProviders` (which reads the id alone, so that
   * a page load never touches a secret) tell the login page something untrue.
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
