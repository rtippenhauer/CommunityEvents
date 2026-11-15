import { Module } from '@nestjs/common';
import { AppConfigModule } from '../app-config/app-config.module';
import { AuditModule } from '../audit/audit.module';
import { EmailService } from './email.service';
import { BrevoService } from './brevo.service';
import { ResendService } from './resend.service';
import { EmailDispatcherService } from './email-dispatcher.service';
import { BrevoWebhookService } from './brevo-webhook.service';
import { InboundEmailLogService } from './inbound-email-log.service';
import { EmailWebhookController } from './email-webhook.controller';
import { MailSelfTestService } from './mail-selftest.service';

@Module({
  // AppConfigModule for the tenant's brand name, substituted into every
  // outgoing subject and body. No cycle: AppConfigModule imports nothing.
  // AuditModule for the mail-chain self-test, which is an admin action and is
  // audited like one (v2-48).
  imports: [AppConfigModule, AuditModule],
  controllers: [EmailWebhookController],
  providers: [
    EmailService,
    BrevoService,
    ResendService,
    EmailDispatcherService,
    BrevoWebhookService,
    InboundEmailLogService,
    MailSelfTestService,
  ],
  // BrevoService is exported for the admin screen's quota cross-check, which
  // asks Brevo what is left of the account's daily allowance. Sending still
  // goes through EmailService.
  exports: [
    EmailService,
    EmailDispatcherService,
    BrevoWebhookService,
    BrevoService,
    // Exported because the inbound path lives in CalendarModule and the
    // throttler guard is global: the one writer of this table is reached from
    // both, which is what keeps it the only writer (v2-34).
    InboundEmailLogService,
    // The self-test has three callers outside this module: the admin screen's
    // button, `PATCH email/config`'s key-change reset, and the reply branch in
    // CalendarService. It lives HERE rather than beside that reply branch
    // because CalendarModule already imports this one -- the other direction
    // would be a cycle -- and because it needs nothing from CalendarService.
    MailSelfTestService,
  ],
})
export class EmailModule {}
