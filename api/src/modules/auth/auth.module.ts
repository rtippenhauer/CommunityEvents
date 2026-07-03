import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { UserEntity } from '../../database/entities/user.entity';
import { OAuthAccountEntity } from '../../database/entities/oauth-account.entity';
import { LoginSessionEntity } from '../../database/entities/login-session.entity';
import { FacebookDeletionRequestEntity } from '../../database/entities/facebook-deletion-request.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { EventRsvpEntity } from '../../database/entities/event-rsvp.entity';
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

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      OAuthAccountEntity,
      LoginSessionEntity,
      FacebookDeletionRequestEntity,
      EventEntity,
      EventRsvpEntity,
    ]),
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
