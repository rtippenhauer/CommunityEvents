import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthService } from '../auth.service';
import { CitiesService } from '../../cities/cities.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
    private readonly citiesService: CitiesService,
  ) {
    super({
      clientID: configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: `${configService.getOrThrow<string>('APP_URL')}/api/v1/auth/google/callback`,
      scope: ['email', 'profile'],
      passReqToCallback: true,
    });
  }

  // Google always redirects back to the single registered callbackURL, so by the
  // time validate() runs, req.headers.host is that fixed host — never the chapter
  // subdomain (e.g. dayton.stage.dinnerbears.com) the user actually started from.
  // The only place that original Host is visible is here, on the initial redirect-
  // to-Google request, so it's captured into `state` and decoded back out below.
  authenticate(req: Request, options: Record<string, unknown> = {}): void {
    const inviteToken = (req.query as { inviteToken?: string }).inviteToken;
    const originHost = req.headers.host ?? '';
    const state = Buffer.from(JSON.stringify({ t: inviteToken ?? '', h: originHost })).toString('base64url');
    super.authenticate(req, { ...options, state });
  }

  async validate(
    req: { query: { state?: string } } & { authOriginHost?: string },
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) throw new UnauthorizedException('No email from Google');
      console.log(`[BOOTSTRAP] Google ID: ${profile.id}  Email: ${email}`);

      let inviteToken: string | undefined;
      let originHost: string | undefined;
      try {
        const decoded = JSON.parse(
          Buffer.from(req.query.state ?? '', 'base64url').toString('utf8'),
        ) as { t?: string; h?: string };
        inviteToken = decoded.t || undefined;
        originHost = decoded.h || undefined;
      } catch {
        // Malformed/missing state — proceed without invite token or origin host.
      }

      const photo = profile.photos?.[0]?.value ?? null;
      const subdomain = originHost?.split('.')[0];
      const city = await this.citiesService.findBySubdomainOrNull(subdomain);
      const user = await this.authService.findOrCreateGoogleUser(
        profile.id,
        email,
        profile.displayName ?? email,
        inviteToken,
        photo,
        city?.id,
      );
      // Passed through (with passReqToCallback) to AuthController.googleCallback,
      // which validates it against the configured base domain before using it.
      req.authOriginHost = originHost;
      done(null, user);
    } catch (err) {
      done(err as Error);
    }
  }
}
