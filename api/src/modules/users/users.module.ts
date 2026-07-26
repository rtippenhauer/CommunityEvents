import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { OAuthAccountEntity } from '../../database/entities/oauth-account.entity';
import { LoginSessionEntity } from '../../database/entities/login-session.entity';
import { PushSubscriptionEntity } from '../../database/entities/push-subscription.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ProfilePhotosController } from './profile-photos.controller';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';
import { AvatarsModule } from '../avatars/avatars.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserEntity,
      OAuthAccountEntity,
      LoginSessionEntity,
      PushSubscriptionEntity,
    ]),
    EmailModule,
    AuditModule,
    AvatarsModule,
  ],
  providers: [UsersService],
  controllers: [UsersController, ProfilePhotosController],
  exports: [UsersService],
})
export class UsersModule {}
