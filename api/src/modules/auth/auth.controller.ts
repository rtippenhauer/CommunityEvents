import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthFlowError } from '../../common/errors/auth-flow.error';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { AuthService } from './auth.service';
import { CitiesService } from '../cities/cities.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FacebookAuthDto } from './dto/facebook-auth.dto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { OAuthProvider } from '../../database/enums';
import type { users as User } from '@prisma/client';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import type { TenantContext } from '../../common/tenant/tenant-context';
import { runWithTenant } from '../../common/tenant/tenant-store';
import { GoogleOAuthError, GoogleOAuthService } from './oauth/google-oauth.service';
import { OAuthHandoffService } from './oauth/oauth-handoff.service';
import { FacebookOAuthService } from './oauth/facebook-oauth.service';
import type { OAuthState } from './oauth/oauth-state.util';
import { OAuthHandoffDto } from './dto/oauth-handoff.dto';
import type { Profile as GoogleProfile } from 'passport-google-oauth20';
import {
  ACCESS_TOKEN_COOKIE,
  accessTokenCookieOptions,
  staleAccessTokenCookieVariants,
} from '../../common/utils/auth-cookie.util';

@Controller('auth')
export class AuthController {
  private readonly frontendUrl: string;
  private readonly baseDomain: string;
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly citiesService: CitiesService,
    private readonly tenantResolution: TenantResolutionService,
    private readonly googleOAuth: GoogleOAuthService,
    private readonly handoffService: OAuthHandoffService,
    private readonly facebookOAuth: FacebookOAuthService,
    configService: ConfigService,
  ) {
    this.frontendUrl = configService.get<string>('APP_URL', 'http://localhost:8081');
    // City subdomains are siblings of the main app host, not children of it (e.g.
    // cincinnati.dinnerbears.com sits alongside www.dinnerbears.com, not under it),
    // so the allowed redirect zone is APP_URL's host with any leading "www." stripped.
    // Set BASE_DOMAIN explicitly in .env to override this default.
    const defaultBaseDomain = new URL(this.frontendUrl).hostname.replace(/^www\./, '');
    this.baseDomain = configService.get<string>('BASE_DOMAIN', defaultBaseDomain);
  }

  // Host-only. See accessTokenCookieOptions -- the scope is the whole point:
  // under v2 a tenant is a domain, so a cookie on the shared base domain is one
  // session across every community.
  private accessTokenCookieOptions() {
    return accessTokenCookieOptions();
  }

  // Clears every variant a browser might still hold -- both Secure flags, and
  // the pre-v2-6 domain-scoped pair -- so at most one access_token can exist
  // after a login. See staleAccessTokenCookieVariants for why each is listed.
  private clearStaleAccessTokenCookies(res: Response): void {
    for (const options of staleAccessTokenCookieVariants(this.baseDomain)) {
      res.clearCookie(ACCESS_TOKEN_COOKIE, options);
    }
  }

  /**
   * The community this request arrived on.
   *
   * Unreachable as a failure behind TenantMiddleware, which 404s an unresolved
   * host before any handler runs -- but these are authentication paths, and the
   * alternative to throwing is signing somebody in without knowing where.
   */
  private requireTenant(req: Request): TenantContext {
    const tenant = req.tenant;
    if (!tenant) throw new UnauthorizedException('No community resolved for this request.');
    return tenant;
  }

  /**
   * Sends a failed sign-in to an error page **on the community it belongs to**.
   *
   * `tenantId` is absent only when the failure happened before the state
   * verified, i.e. when nothing trustworthy says which community this was. The
   * deployment's own page is the fallback rather than a guess.
   *
   * Note what is no longer here: v1 carried the origin host inside an unsigned
   * `state` and had to check it against an allowlist before putting it in a
   * `Location` header, because anyone could craft one. The host is now looked
   * up from the tenant registry by a signed id, so there is no
   * attacker-supplied host to validate and the open-redirect surface is gone
   * rather than guarded.
   */
  private async authErrorRedirect(
    res: Response,
    reason: string,
    tenantId?: number,
    email?: string,
  ): Promise<void> {
    const base = tenantId
      ? await this.tenantResolution.baseUrlFor(tenantId)
      : this.frontendUrl;
    const params = new URLSearchParams({ reason });
    if (email) params.set('email', email);
    res.redirect(`${base}/auth/error?${params.toString()}`);
  }

  /**
   * The city a new member lands in, from the community's own subdomain.
   *
   * v1 read this off the request's Host header, which cannot work at a callback
   * that always arrives on one fixed host -- it would file every OAuth
   * registration under the root community's default city. The tenant's
   * registered domain is the same information, available at the point it is
   * actually needed. Returns undefined when nothing matches, which is what
   * `resolveCityId` already treats as "use the default".
   */
  private async cityForTenant(tenantId: number): Promise<number | undefined> {
    try {
      const baseUrl = await this.tenantResolution.baseUrlFor(tenantId);
      const subdomain = new URL(baseUrl).hostname.split('.')[0];
      const city = await this.citiesService.findBySubdomainOrNull(subdomain);
      return city?.id;
    } catch {
      return undefined;
    }
  }

  // --- Google OAuth ---

  /**
   * Starts a Google sign-in **with this community's own app**
   * (REQ-TENANT-01.9).
   *
   * No longer `AuthGuard('google')`: that resolves one strategy registered once
   * at module init from the deployment's env credentials, and there is no such
   * thing now. Which app a member is sent to is a property of the community
   * they are standing on.
   */
  @Get('google')
  async googleLogin(
    @Req() req: Request,
    @Res() res: Response,
    @Query('inviteToken') inviteToken?: string,
  ): Promise<void> {
    const tenant = req.tenant;
    if (!tenant) {
      // Unreachable behind TenantMiddleware, which 404s an unresolved host
      // before any handler runs. Guarding anyway: the alternative is starting
      // an OAuth flow with no idea whose it is.
      await this.authErrorRedirect(res, 'provider_not_offered');
      return;
    }

    try {
      res.redirect(await this.googleOAuth.authorizationUrl(req, tenant.id, inviteToken));
    } catch (err) {
      const reason = err instanceof GoogleOAuthError ? err.reason : 'exchange_failed';
      if (!(err instanceof GoogleOAuthError)) {
        this.logger.error(`Could not start Google sign-in: ${(err as Error).message}`);
      }
      await this.authErrorRedirect(res, reason, tenant.id);
    }
  }

  /**
   * Google's one registered callback, for every community (REQ-TENANT-01.8).
   *
   * Three things are true here at once and each one is a trap:
   *
   *  - **The Host header is this host**, never the community the member started
   *    on, so `req.tenant` resolves to the root tenant and is the wrong answer
   *    to every question below.
   *  - **The signed `state` is the only thing that knows** which community this
   *    is, which is why it is verified before a credential is loaded or a user
   *    is looked up.
   *  - **The session cookie cannot be set here.** It is host-only, so a cookie
   *    written on this host never reaches the community's own. The login leaves
   *    as a single-use ticket instead.
   */
  @Get('google/callback')
  async googleCallback(@Req() req: Request, @Res() res: Response): Promise<void> {
    let state: OAuthState;
    let profile: GoogleProfile;
    try {
      ({ state, profile } = await this.googleOAuth.completeCallback(req));
    } catch (err) {
      // The error carries a community only if it happened after `state`
      // verified. Before that, nothing trustworthy says whose sign-in this was,
      // and this deployment's own error page is the only honest destination.
      const reason = err instanceof GoogleOAuthError ? err.reason : 'exchange_failed';
      const tenantId = err instanceof GoogleOAuthError ? err.tenantId : undefined;
      if (!(err instanceof GoogleOAuthError)) {
        this.logger.error(`Google callback failed: ${(err as Error).message}`);
      }
      await this.authErrorRedirect(res, reason, tenantId);
      return;
    }

    const email = profile.emails?.[0]?.value;
    if (!email) {
      await this.authErrorRedirect(res, 'no_email', state.tenantId);
      return;
    }

    // Everything from here belongs to the community the flow started on, not to
    // the host it landed on. `users` and `oauth_accounts` are scoped and the
    // same address is a different person in each community (REQ-TENANT-01.5),
    // so running this in the ambient (root) context would resolve the wrong
    // member -- or create one in the wrong place.
    //
    // The callback awaits inside runWithTenant rather than returning its
    // promise: Prisma's promises are lazy, and handing one back would build the
    // query in the context and run it outside.
    let handoffToken: string;
    try {
      handoffToken = await runWithTenant(state.tenantId, async () => {
        const user = await this.authService.findOrCreateGoogleUser(
          profile.id,
          email,
          profile.displayName ?? email,
          state.inviteToken,
          profile.photos?.[0]?.value ?? null,
          await this.cityForTenant(state.tenantId),
        );
        return await this.handoffService.issue(user.id);
      });
    } catch (err) {
      if (err instanceof AuthFlowError) {
        await this.authErrorRedirect(res, err.reason, state.tenantId, err.boundEmail);
        return;
      }
      this.logger.error(`Google sign-in failed after exchange: ${(err as Error).message}`);
      await this.authErrorRedirect(res, 'unknown', state.tenantId);
      return;
    }

    const baseUrl = await this.tenantResolution.baseUrlFor(state.tenantId);
    const params = new URLSearchParams({ handoff: handoffToken });
    res.redirect(`${baseUrl}/auth/callback?${params.toString()}`);
  }

  /**
   * Redeems the ticket the callback issued, on the community's own host, for a
   * session cookie scoped to it (REQ-TENANT-01.8).
   *
   * A POST from the landing page rather than something the redirect does by
   * itself, and that is what keeps `SameSite=strict` workable: the cross-site
   * hop is the navigation *before* this, which carries no cookie because none
   * exists yet. This request is same-site, so the cookie it sets is stored and
   * sent normally from then on.
   *
   * `oauth_handoffs` is tenant-scoped, so a ticket minted for another community
   * simply is not found here -- the isolation costs no comparison in this
   * method.
   */
  @Post('handoff')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async oauthHandoff(
    @Body() dto: OAuthHandoffDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const userId = await this.handoffService.redeem(dto.token);
    const user = userId ? await this.authService.findActiveUserById(userId) : null;
    if (!user) {
      throw new UnauthorizedException({
        message: 'This sign-in link has already been used or has expired.',
        reason: 'handoff_invalid',
      });
    }

    const { accessToken } = await this.authService.issueTokens(user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    this.clearStaleAccessTokenCookies(res);
    res.cookie(ACCESS_TOKEN_COOKIE, accessToken, this.accessTokenCookieOptions());
    return { message: 'ok' };
  }

  // --- Facebook OAuth ---

  @Post('facebook')
  async facebookLogin(
    @Body() dto: FacebookAuthDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const tenant = this.requireTenant(req);
    // Verified against this community's own Meta app, not merely against
    // Facebook -- see FacebookOAuthService for why that distinction is the
    // whole point once apps are per community.
    const fbUser = await this.facebookOAuth.profileFor(tenant.id, dto.accessToken);
    const fbPhoto = fbUser.picture?.data?.url ?? null;
    const city = await this.cityForTenant(tenant.id);

    let user;
    try {
      user = await this.authService.findOrCreateFacebookUser(
        fbUser.id,
        fbUser.email ?? null,
        fbUser.name,
        dto.inviteToken,
        fbPhoto,
        fbUser.link ?? null,
        city,
      );
    } catch (err) {
      if (err instanceof AuthFlowError) {
        const reason = err.reason;
        if (reason === 'not_active') throw new UnauthorizedException({ message: 'Account not active', reason });
        if (reason === 'no_invite') throw new UnauthorizedException({ message: 'No invite', reason });
        if (reason === 'provider_not_linked') throw new UnauthorizedException({ message: 'Facebook not linked to this account', reason });
        if (reason === 'invite_expired') throw new BadRequestException({ message: 'Invite expired', reason });
        if (reason === 'invite_used') throw new BadRequestException({ message: 'Invite used', reason });
        if (reason === 'invite_email_mismatch') throw new BadRequestException({ message: 'Invite email mismatch', reason });
        throw new BadRequestException({ message: 'Invalid invite', reason: 'invalid_invite' });
      }
      throw err;
    }

    const { accessToken } = await this.authService.issueTokens(user, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    this.clearStaleAccessTokenCookies(res);
    res.cookie('access_token', accessToken, this.accessTokenCookieOptions());

    return { message: 'ok' };
  }

  @Post('facebook/link')
  @UseGuards(JwtAuthGuard)
  async facebookLink(
    @Body() dto: FacebookAuthDto,
    @CurrentUser() user: User,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const fbUser = await this.facebookOAuth.profileFor(
      this.requireTenant(req).id,
      dto.accessToken,
    );

    await this.authService.linkFacebook(user.id, fbUser.id, fbUser.email ?? null, fbUser.link ?? null);
    return { message: 'Facebook account linked' };
  }

  // --- Meta Data Deletion Callback (REQ-DEL-05) ---

  @Post('facebook/deletion-callback')
  @HttpCode(200)
  async facebookDeletionCallback(
    @Body('signed_request') signedRequest: string,
    @Req() req: Request,
  ): Promise<{ url: string; confirmation_code: string }> {
    if (!signedRequest) throw new UnauthorizedException('Missing signed_request');

    const parts = signedRequest.split('.');
    if (parts.length !== 2) throw new UnauthorizedException('Malformed signed_request');
    const [encodedSig, payload] = parts;

    // Meta posts this to the callback URL registered on the app that was
    // deleted, and that app belongs to one community -- so the secret that
    // verifies it is that community's, resolved from the host it arrived on.
    const appSecret = await this.facebookOAuth.appSecretFor(this.requireTenant(req).id);
    if (!appSecret) throw new UnauthorizedException('This community does not offer Facebook sign-in.');

    const expected = createHmac('sha256', appSecret).update(payload).digest();
    const actual = Buffer.from(encodedSig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new UnauthorizedException('Invalid signed_request signature');
    }

    const data = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { user_id: string };

    const confirmationCode = await this.authService.handleFacebookDeletion(data.user_id);

    return {
      url: `${this.frontendUrl}/account-deletion/status?code=${confirmationCode}`,
      confirmation_code: confirmationCode,
    };
  }

  @Get('facebook/deletion-status')
  async facebookDeletionStatus(
    @Req() req: Request,
  ): Promise<{ status: 'pending' | 'completed' | 'not_found' }> {
    const code = (req.query['code'] as string) ?? '';
    return this.authService.getFacebookDeletionStatus(code);
  }

  // --- Connected Accounts (REQ-DEL-01) ---

  @Get('providers')
  @UseGuards(JwtAuthGuard)
  async getProviders(@CurrentUser() user: User) {
    return this.authService.getConnectedProviders(user.id);
  }

  @Delete('providers/:provider')
  @UseGuards(JwtAuthGuard)
  @HttpCode(204)
  async disconnectProvider(
    @Param('provider') provider: string,
    @CurrentUser() user: User,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const normalized = provider.toLowerCase() as OAuthProvider;
    if (![OAuthProvider.GOOGLE, OAuthProvider.FACEBOOK].includes(normalized)) {
      throw new UnauthorizedException('Invalid provider');
    }

    try {
      await this.authService.disconnectProvider(user.id, normalized);
    } catch (err) {
      if (err instanceof ConflictException && (err.message as string) === 'ONLY_AUTH_METHOD') {
        res.status(409).json({ error: 'ONLY_AUTH_METHOD', message: 'This is your only login method.' });
        return;
      }
      throw err;
    }
  }

  // --- Email / Password ---

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(201)
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    const subdomain = req.headers['x-subdomain'];
    const city = await this.citiesService.findBySubdomainOrNull(
      typeof subdomain === 'string' ? subdomain : undefined,
    );

    try {
      await this.authService.registerWithPassword(
        dto.inviteToken,
        dto.fullName,
        dto.email,
        dto.password,
        city?.id,
      );
    } catch (err) {
      if (err instanceof AuthFlowError) {
        const reason = err.reason;
        if (reason === 'invite_expired') throw new BadRequestException({ message: 'Invite expired', reason });
        if (reason === 'invite_used') throw new BadRequestException({ message: 'Invite used', reason });
        if (reason === 'invite_email_mismatch') throw new BadRequestException({ message: 'Invite email mismatch', reason });
        throw new BadRequestException({ message: 'Invalid invite', reason: 'invalid_invite' });
      }
      throw err;
    }
    return { message: 'Registration successful. Check your email to verify your account.' };
  }

  @Post('automation-login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  async automationLogin(
    @Body('secret') secret: string,
    @Req() req: Request,
  ): Promise<{ accessToken: string }> {
    return this.authService.automationLogin(secret, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string; failedAttemptsSinceLastLogin?: number; previousLastLoginAt?: Date | null }> {
    const { accessToken, failedAttemptsSinceLastLogin, previousLastLoginAt } =
      await this.authService.loginWithPassword(dto.email, dto.password, {
        userAgent: (req as unknown as { headers: Record<string, string> }).headers['user-agent'],
        ipAddress: (req as unknown as { ip: string }).ip,
      });

    this.clearStaleAccessTokenCookies(res);
    (res as unknown as { cookie: (...args: unknown[]) => void }).cookie(
      'access_token',
      accessToken,
      this.accessTokenCookieOptions(),
    );

    return {
      message: 'ok',
      previousLastLoginAt,
      ...(failedAttemptsSinceLastLogin > 0 ? { failedAttemptsSinceLastLogin } : {}),
    };
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string): Promise<{ message: string }> {
    if (!token) throw new BadRequestException('Missing token');
    await this.authService.verifyEmail(token);
    return { message: 'Email verified' };
  }

  @Post('resend-verification')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(200)
  async resendVerification(@Body('email') email: string): Promise<{ message: string }> {
    if (email) await this.authService.resendVerification(email);
    return { message: 'If that email is registered and unverified, a new link has been sent.' };
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.authService.forgotPassword(dto.email);
    return { message: 'If that email is registered, a reset link has been sent.' };
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ message: string }> {
    await this.authService.resetPassword(dto.token, dto.password);
    return { message: 'Password updated' };
  }

  @Post('set-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async setPassword(
    @Body('email') email: string,
    @Body('password') password: string,
    @CurrentUser() user: User,
  ): Promise<{ message: string; needsVerification: boolean }> {
    if (!email) throw new BadRequestException('Email is required');
    if (!password || password.length < 8) throw new BadRequestException('Password must be at least 8 characters');
    const result = await this.authService.setPassword(user.id, email, password);
    return { message: result.needsVerification ? 'Check your email to verify your address.' : 'Password set', ...result };
  }

  @Patch('password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: User,
  ): Promise<{ message: string }> {
    await this.authService.changePassword(user.id, dto.currentPassword, dto.newPassword);
    return { message: 'Password updated' };
  }

  // --- Session ---

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: User) {
    return this.authService.me(user);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(
    @Req() req: Request & { user: User; cookies: Record<string, string> },
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ message: string }> {
    const token = req.cookies['access_token'];
    if (token) {
      const payload = this.authService['jwtService'].decode(token) as { jti: string } | null;
      if (payload?.jti) {
        await this.authService.logout(payload.jti, req.user.id);
      }
    }
    this.clearStaleAccessTokenCookies(res);
    return { message: 'Logged out' };
  }
}
