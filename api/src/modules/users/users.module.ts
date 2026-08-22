import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ProfilePhotosController } from './profile-photos.controller';
import { EmailModule } from '../email/email.module';
import { AppConfigModule } from '../app-config/app-config.module';
import { AuditModule } from '../audit/audit.module';
import { AvatarsModule } from '../avatars/avatars.module';

@Module({
  imports: [
    EmailModule,
    AppConfigModule,
    AuditModule,
    AvatarsModule,
  ],
  providers: [UsersService],
  controllers: [UsersController, ProfilePhotosController],
  exports: [UsersService],
})
export class UsersModule {}
