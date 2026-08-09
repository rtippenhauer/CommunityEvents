import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { GoogleStrategy } from './strategies/google.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleCallbackGuard } from '../../common/guards/google-callback.guard';
import { InvitesModule } from '../invites/invites.module';
import { CitiesModule } from '../cities/cities.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailModule } from '../email/email.module';
import { CommunityModule } from '../community/community.module';
import type { events as EventRow, event_rsvps as EventRsvp, facebook_deletion_requests as FacebookDeletionRequest, login_sessions as LoginSession, oauth_accounts as OAuthAccount, users as User } from '@prisma/client';

@Module({
  imports: [
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
  providers: [AuthService, GoogleStrategy, JwtStrategy, GoogleCallbackGuard],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
