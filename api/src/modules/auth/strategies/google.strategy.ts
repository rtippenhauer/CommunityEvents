import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthService } from '../auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    configService: ConfigService,
    private readonly authService: AuthService,
  ) {
    super({
      clientID: configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: `${configService.getOrThrow<string>('APP_URL')}/api/v1/auth/google/callback`,
      scope: ['email', 'profile'],
      passReqToCallback: true,
    });
  }

  authenticate(req: Request, options: Record<string, unknown> = {}): void {
    const inviteToken = (req.query as { inviteToken?: string }).inviteToken;
    super.authenticate(req, { ...options, state: inviteToken ?? '' });
  }

  async validate(
    req: { query: { state?: string } },
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) throw new UnauthorizedException('No email from Google');
      console.log(`[BOOTSTRAP] Google ID: ${profile.id}  Email: ${email}`);

      const inviteToken = req.query.state ?? undefined;
      const photo = profile.photos?.[0]?.value ?? null;
      const user = await this.authService.findOrCreateGoogleUser(
        profile.id,
        email,
        profile.displayName ?? email,
        inviteToken,
        photo,
      );
      done(null, user);
    } catch (err) {
      done(err as Error);
    }
  }
}
