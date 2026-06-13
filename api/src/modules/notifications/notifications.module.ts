import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationEntity } from '../../database/entities/notification.entity';
import { PushSubscriptionEntity } from '../../database/entities/push-subscription.entity';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [TypeOrmModule.forFeature([NotificationEntity, PushSubscriptionEntity])],
  providers: [NotificationsService, PushService],
  controllers: [NotificationsController],
  exports: [NotificationsService, PushService],
})
export class NotificationsModule {}
