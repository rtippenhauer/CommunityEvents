import { Body, Controller, Headers, Logger, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../../database/prisma/prisma.service';
import { EmailStatus, SuppressionReason } from '../../database/enums';
import { BrevoWebhookService } from './brevo-webhook.service';
import { EmailService } from './email.service';
import { runUnscoped } from '../../common/tenant/tenant-store';

interface BrevoWebhookEvent {
  event: string;
  email: string;
  messageId?: string;
  subject?: string;
  date?: string;
  ts?: number;
  'message-id'?: string;
}

@Controller('email/webhook')
export class EmailWebhookController {
  private readonly logger = new Logger(EmailWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly config: ConfigService,
    private readonly webhookRegistration: BrevoWebhookService,
  ) {}

  /**
   * Deliverability events from Brevo, for the community this host belongs to.
   *
   * Authentication is per-community as of v2-9 and travels in an Authorization
   * header, because the deployment-wide `?secret=` it replaces put a shared
   * credential in every access log and proxy buffer between here and Brevo. The
   * token is looked up by tenant — resolved from the Host header by
   * `TenantMiddleware` before this runs — and compared after decryption, since
   * an encrypted column cannot be searched by value.
   *
   * **The query-string form still works**, on the deployment-wide env secret
   * only. A webhook registered before this change keeps delivering until its
   * community re-registers, and losing events in the meantime is the outcome
   * worth avoiding: a bounce that never arrives is an address the deployment
   * keeps mailing.
   */
  @Post('brevo')
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  async brevoWebhook(
    @Query('secret') secret: string | undefined,
    @Headers('authorization') authorization: string | undefined,
    @Body() events: BrevoWebhookEvent | BrevoWebhookEvent[],
  ): Promise<{ ok: boolean }> {
    const bearer = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : undefined;
    const legacySecret = this.config.get<string>('BREVO_WEBHOOK_SECRET', '');
    const authorized =
      (await this.webhookRegistration.verifyToken(bearer)) ||
      Boolean(legacySecret && secret === legacySecret);

    if (!authorized) {
      throw new UnauthorizedException('Invalid Brevo webhook secret');
    }

    const list = Array.isArray(events) ? events : [events];

    for (const evt of list) {
      await this.handleEvent(evt);
    }

    return { ok: true };
  }

  private async handleEvent(evt: BrevoWebhookEvent): Promise<void> {
    this.logger.debug(`Brevo webhook: ${evt.event} for ${evt.email}`);

    const email = evt.email.toLowerCase();

    // Deliberately cross-tenant, for the same reason `email_suppressions` is a
    // global model: what this webhook reports is a property of the *address* --
    // it bounced, its owner unsubscribed, its owner marked mail as spam -- not
    // of whichever community happened to send the message. Once one address can
    // hold an account in several communities (REQ-TENANT-01.5), scoping this to
    // the tenant Brevo happened to POST to would leave every other community
    // still mailing a dead or unwilling address, which is exactly what gets a
    // sending domain blocked.
    //
    // `updateMany` rather than a find-then-update: it covers every matching row
    // in one statement, and the 'delivered' case's pending-only condition
    // becomes part of the filter instead of a read-modify-write race.
    const setEmailStatus = (emailStatus: EmailStatus, onlyWhen?: EmailStatus) =>
      runUnscoped('email deliverability applies to an address in every tenant', async () =>
        await this.prisma.users.updateMany({
          where: { email, ...(onlyWhen ? { emailStatus: onlyWhen } : {}) },
          data: { emailStatus },
        }),
      );

    switch (evt.event) {
      case 'delivered':
        await setEmailStatus(EmailStatus.ACTIVE, EmailStatus.PENDING);
        break;

      case 'hard_bounce':
        await setEmailStatus(EmailStatus.BOUNCED);
        await this.emailService.suppress(evt.email, SuppressionReason.BOUNCED);
        break;

      case 'unsubscribed':
        await setEmailStatus(EmailStatus.UNSUBSCRIBED);
        await this.emailService.suppress(evt.email, SuppressionReason.UNSUBSCRIBED);
        break;

      case 'spam':
        await setEmailStatus(EmailStatus.COMPLAINED);
        await this.emailService.suppress(evt.email, SuppressionReason.COMPLAINED);
        break;

      case 'soft_bounce':
        this.logger.warn(`Soft bounce for ${evt.email}`);
        break;

      case 'blocked':
        this.logger.warn(`Email blocked by Brevo for ${evt.email}`);
        break;

      default:
        break;
    }
  }
}
