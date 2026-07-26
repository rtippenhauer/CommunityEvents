import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AvatarEntity } from '../../database/entities/avatar.entity';
import { AvatarsService } from './avatars.service';
import { AvatarsController } from './avatars.controller';
import { AvatarsAdminController } from './avatars-admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AvatarEntity])],
  providers: [AvatarsService],
  controllers: [AvatarsController, AvatarsAdminController],
  exports: [AvatarsService],
})
export class AvatarsModule {}
