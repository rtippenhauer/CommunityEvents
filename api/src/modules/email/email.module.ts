import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailQueueEntity } from '../../database/entities/email-queue.entity';
import { EmailSuppressionEntity } from '../../database/entities/email-suppression.entity';
import { EmailProviderConfigEntity } from '../../database/entities/email-provider-config.entity';
import { NotificationPreferencesEntity } from '../../database/entities/notification-preferences.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { EmailService } from './email.service';
import { BrevoService } from './brevo.service';
import { GmailService } from './gmail.service';
import { EmailDispatcherService } from './email-dispatcher.service';
import { EmailWebhookController } from './email-webhook.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      EmailQueueEntity,
      EmailSuppressionEntity,
      EmailProviderConfigEntity,
      NotificationPreferencesEntity,
      UserEntity,
    ]),
  ],
  controllers: [EmailWebhookController],
  providers: [EmailService, BrevoService, GmailService, EmailDispatcherService],
  exports: [EmailService],
})
export class EmailModule {}
