import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnnouncementEntity } from '../../database/entities/announcement.entity';
import { AnnouncementCommentEntity } from '../../database/entities/announcement-comment.entity';
import { ContentFlagEntity } from '../../database/entities/content-flag.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsAdminController } from './announcements-admin.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AnnouncementEntity, AnnouncementCommentEntity, ContentFlagEntity, UserEntity]),
    NotificationsModule,
  ],
  providers: [AnnouncementsService],
  controllers: [AnnouncementsController, AnnouncementsAdminController],
})
export class AnnouncementsModule {}
