import { Module } from '@nestjs/common';
import { AppConfigModule } from '../app-config/app-config.module';
import { EmailService } from './email.service';
import { BrevoService } from './brevo.service';
import { ResendService } from './resend.service';
import { EmailDispatcherService } from './email-dispatcher.service';
import { BrevoWebhookService } from './brevo-webhook.service';
import { EmailWebhookController } from './email-webhook.controller';

@Module({
  // AppConfigModule for the tenant's brand name, substituted into every
  // outgoing subject and body. No cycle: AppConfigModule imports nothing.
  imports: [AppConfigModule],
  controllers: [EmailWebhookController],
  providers: [
    EmailService,
    BrevoService,
    ResendService,
    EmailDispatcherService,
    BrevoWebhookService,
  ],
  // BrevoService is exported for the admin screen's quota cross-check, which
  // asks Brevo what is left of the account's daily allowance. Sending still
  // goes through EmailService.
  exports: [EmailService, EmailDispatcherService, BrevoWebhookService, BrevoService],
})
export class EmailModule {}
