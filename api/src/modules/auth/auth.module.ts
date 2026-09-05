import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleOAuthService } from './oauth/google-oauth.service';
import { OAuthHandoffService } from './oauth/oauth-handoff.service';
import { FacebookOAuthService } from './oauth/facebook-oauth.service';
import { InvitesModule } from '../invites/invites.module';
import { CitiesModule } from '../cities/cities.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../email/email.module';
import { CommunityModule } from '../community/community.module';
import type { events as EventRow, event_rsvps as EventRsvp, facebook_deletion_requests as FacebookDeletionRequest, login_sessions as LoginSession, oauth_accounts as OAuthAccount, users as User } from '@prisma/client';
import { AppConfigModule } from '../app-config/app-config.module';

@Module({
  imports: [
    // AuthService reads this community's primary colour for the buttons in
    // its password-reset and verification emails (v2-10). AppConfigModule is
    // not @Global, so without this the app fails to boot.
    AppConfigModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRES_IN', '7d') as StringValue,
        },
      }),
      inject: [ConfigService],
    }),
    InvitesModule,
    CitiesModule,
    AuditModule,
    NotificationsModule,
    EmailModule,
    CommunityModule,
  ],
  // No GoogleStrategy: Google's credentials are per community now, so the
  // strategy is built per request inside GoogleOAuthService rather than
  // registered once here. See REQ-TENANT-01.9.
  providers: [AuthService, JwtStrategy, GoogleOAuthService, FacebookOAuthService, OAuthHandoffService],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
