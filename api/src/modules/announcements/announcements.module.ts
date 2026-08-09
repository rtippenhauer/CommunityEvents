import { Module } from '@nestjs/common';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementsAdminController } from './announcements-admin.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    NotificationsModule,
  ],
  providers: [AnnouncementsService],
  controllers: [AnnouncementsController, AnnouncementsAdminController],
})
export class AnnouncementsModule {}
