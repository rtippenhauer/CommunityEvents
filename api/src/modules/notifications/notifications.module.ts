import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { NotificationsController } from './notifications.controller';
import { AppConfigModule } from '../app-config/app-config.module';

@Module({
  // PushService resolves this community's logo for the notification icon
  // (v2-10). AppConfigModule is not @Global, unlike PrismaModule, so this
  // import is what makes AppConfigService injectable here -- without it the
  // app fails to boot, which tsc does not catch.
  imports: [AppConfigModule],
  providers: [NotificationsService, PushService],
  controllers: [NotificationsController],
  exports: [NotificationsService, PushService],
})
export class NotificationsModule {}
