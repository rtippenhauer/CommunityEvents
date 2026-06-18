import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentReportEntity } from '../../database/entities/content-report.entity';
import { EventCommentEntity } from '../../database/entities/event-comment.entity';
import { EventCommentReplyEntity } from '../../database/entities/event-comment-reply.entity';
import { AnnouncementCommentEntity } from '../../database/entities/announcement-comment.entity';
import { RestaurantRatingEntity } from '../../database/entities/restaurant-rating.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ContentReportEntity,
      EventCommentEntity,
      EventCommentReplyEntity,
      AnnouncementCommentEntity,
      RestaurantRatingEntity,
      UserEntity,
    ]),
    NotificationsModule,
  ],
  providers: [ReportsService],
  controllers: [ReportsController],
})
export class ReportsModule {}
