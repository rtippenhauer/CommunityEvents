import { Module } from '@nestjs/common';
import { AvatarsService } from './avatars.service';
import { AvatarsController } from './avatars.controller';
import { AvatarsAdminController } from './avatars-admin.controller';

@Module({
  providers: [AvatarsService],
  controllers: [AvatarsController, AvatarsAdminController],
  exports: [AvatarsService],
})
export class AvatarsModule {}
