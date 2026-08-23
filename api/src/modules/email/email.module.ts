import { Module } from '@nestjs/common';
import { AppConfigModule } from '../app-config/app-config.module';
import { EmailService } from './email.service';
import { BrevoService } from './brevo.service';
import { ResendService } from './resend.service';
import { EmailDispatcherService } from './email-dispatcher.service';
import { EmailWebhookController } from './email-webhook.controller';

@Module({
  // AppConfigModule for the tenant's brand name, substituted into every
  // outgoing subject and body. No cycle: AppConfigModule imports nothing.
  imports: [AppConfigModule],
  controllers: [EmailWebhookController],
  providers: [EmailService, BrevoService, ResendService, EmailDispatcherService],
  exports: [EmailService, EmailDispatcherService],
})
export class EmailModule {}
