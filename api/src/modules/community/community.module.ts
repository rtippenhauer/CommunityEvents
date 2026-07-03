import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { MemberPointEntity } from '../../database/entities/member-point.entity';
import { AchievementEntity } from '../../database/entities/achievement.entity';
import { MemberAchievementEntity } from '../../database/entities/member-achievement.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { EventRsvpEntity } from '../../database/entities/event-rsvp.entity';
import { InviteEntity } from '../../database/entities/invite.entity';
import { CustomIconEntity } from '../../database/entities/custom-icon.entity';
import { PointsService } from './points.service';
import { AchievementsService } from './achievements.service';
import { CustomIconsService } from './custom-icons.service';
import { CommunityController } from './community.controller';

@Module({
  imports: [
    MulterModule.register({}),
    TypeOrmModule.forFeature([
      MemberPointEntity,
      AchievementEntity,
      MemberAchievementEntity,
      UserEntity,
      EventEntity,
      EventRsvpEntity,
      InviteEntity,
      CustomIconEntity,
    ]),
  ],
  providers: [PointsService, AchievementsService, CustomIconsService],
  controllers: [CommunityController],
  exports: [PointsService, AchievementsService, CustomIconsService],
})
export class CommunityModule {}
