import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as nodemailer from 'nodemailer';
import { EmailProviderConfigEntity } from '../../database/entities/email-provider-config.entity';

export interface GmailSendPayload {
  toEmail: string;
  toName?: string | null;
  subject: string;
  htmlBody?: string | null;
  textBody?: string | null;
}

@Injectable()
export class GmailService {
  private readonly logger = new Logger(GmailService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(EmailProviderConfigEntity)
    private readonly configRepo: Repository<EmailProviderConfigEntity>,
  ) {}

  private async getEffectiveConfig(): Promise<{
    user: string;
    pass: string;
    fromEmail: string;
    fromName: string;
  }> {
    const db = await this.configRepo.findOne({ where: { id: 1 } });
    return {
      user: db?.gmailUser || this.config.get<string>('GMAIL_USER', ''),
      pass: db?.gmailAppPassword || this.config.get<string>('GMAIL_APP_PASSWORD', ''),
      fromEmail: db?.gmailFromEmail || this.config.get<string>('GMAIL_FROM_EMAIL', ''),
      fromName: db?.gmailFromName || this.config.get<string>('GMAIL_FROM_NAME', 'DinnerBears'),
    };
  }

  async isConfigured(): Promise<boolean> {
    const { user, pass } = await this.getEffectiveConfig();
    return user.length > 0 && pass.length > 0;
  }

  async send(payload: GmailSendPayload): Promise<void> {
    const { user, pass, fromEmail, fromName } = await this.getEffectiveConfig();

    if (!user || !pass) {
      this.logger.warn(`Gmail not configured — skipping email to ${payload.toEmail}`);
      return;
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });

    await transporter.sendMail({
      from: `"${fromName}" <${fromEmail || user}>`,
      to: payload.toName ? `"${payload.toName}" <${payload.toEmail}>` : payload.toEmail,
      subject: payload.subject,
      html: payload.htmlBody ?? undefined,
      text: payload.textBody ?? undefined,
    });
  }
}
