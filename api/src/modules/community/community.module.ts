import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { PointsService } from './points.service';
import { AchievementsService } from './achievements.service';
import { CustomIconsService } from './custom-icons.service';
import { WhatsNewService } from './whats-new.service';
import { CommunityController } from './community.controller';

@Module({
  imports: [
    MulterModule.register({}),
  ],
  providers: [PointsService, AchievementsService, CustomIconsService, WhatsNewService],
  controllers: [CommunityController],
  exports: [PointsService, AchievementsService, CustomIconsService, WhatsNewService],
})
export class CommunityModule {}
