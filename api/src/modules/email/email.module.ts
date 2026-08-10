import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { BrevoService } from './brevo.service';
import { ResendService } from './resend.service';
import { EmailDispatcherService } from './email-dispatcher.service';
import { EmailWebhookController } from './email-webhook.controller';

@Module({
  controllers: [EmailWebhookController],
  providers: [EmailService, BrevoService, ResendService, EmailDispatcherService],
  exports: [EmailService, EmailDispatcherService],
})
export class EmailModule {}
