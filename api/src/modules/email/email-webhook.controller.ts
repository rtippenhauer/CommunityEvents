import { Body, Controller, Logger, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailQueueEntity } from '../../database/entities/email-queue.entity';
import { UserEntity, EmailStatus } from '../../database/entities/user.entity';
import { EmailService } from './email.service';
import { SuppressionReason } from '../../database/entities/email-suppression.entity';

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
    @InjectRepository(EmailQueueEntity)
    private readonly queueRepo: Repository<EmailQueueEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly emailService: EmailService,
  ) {}

  @Post('brevo')
  async brevoWebhook(@Body() events: BrevoWebhookEvent | BrevoWebhookEvent[]): Promise<{ ok: boolean }> {
    const list = Array.isArray(events) ? events : [events];

    for (const evt of list) {
      await this.handleEvent(evt);
    }

    return { ok: true };
  }

  private async handleEvent(evt: BrevoWebhookEvent): Promise<void> {
    this.logger.debug(`Brevo webhook: ${evt.event} for ${evt.email}`);

    const user = await this.userRepo.findOne({ where: { email: evt.email.toLowerCase() } });

    switch (evt.event) {
      case 'delivered':
        if (user && user.emailStatus === EmailStatus.PENDING) {
          user.emailStatus = EmailStatus.ACTIVE;
          await this.userRepo.save(user);
        }
        break;

      case 'hard_bounce':
        if (user) {
          user.emailStatus = EmailStatus.BOUNCED;
          await this.userRepo.save(user);
        }
        await this.emailService.suppress(evt.email, SuppressionReason.BOUNCED);
        break;

      case 'unsubscribed':
        if (user) {
          user.emailStatus = EmailStatus.UNSUBSCRIBED;
          await this.userRepo.save(user);
        }
        await this.emailService.suppress(evt.email, SuppressionReason.UNSUBSCRIBED);
        break;

      case 'spam':
        if (user) {
          user.emailStatus = EmailStatus.COMPLAINED;
          await this.userRepo.save(user);
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
