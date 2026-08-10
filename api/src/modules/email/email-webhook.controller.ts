import { Body, Controller, Logger, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { PrismaService } from '../../database/prisma/prisma.service';
import { EmailStatus, SuppressionReason } from '../../database/enums';
import { EmailService } from './email.service';

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
  ) {}

  @Post('brevo')
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  async brevoWebhook(
    @Query('secret') secret: string | undefined,
    @Body() events: BrevoWebhookEvent | BrevoWebhookEvent[],
  ): Promise<{ ok: boolean }> {
    const expected = this.config.get<string>('BREVO_WEBHOOK_SECRET', '');
    if (!expected || secret !== expected) {
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

    const user = await this.prisma.users.findUnique({
      where: { email: evt.email.toLowerCase() },
    });

    // The entity was mutated then saved; with Prisma each branch issues the
    // update directly. Same single write per event as before.
    const setEmailStatus = (emailStatus: EmailStatus) =>
      this.prisma.users.update({ where: { id: user!.id }, data: { emailStatus } });

    switch (evt.event) {
      case 'delivered':
        if (user && user.emailStatus === EmailStatus.PENDING) {
          await setEmailStatus(EmailStatus.ACTIVE);
        }
        break;

      case 'hard_bounce':
        if (user) {
          await setEmailStatus(EmailStatus.BOUNCED);
        }
        await this.emailService.suppress(evt.email, SuppressionReason.BOUNCED);
        break;

      case 'unsubscribed':
        if (user) {
          await setEmailStatus(EmailStatus.UNSUBSCRIBED);
        }
        await this.emailService.suppress(evt.email, SuppressionReason.UNSUBSCRIBED);
        break;

      case 'spam':
        if (user) {
          await setEmailStatus(EmailStatus.COMPLAINED);
        }
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
