import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

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
  private transporter: nodemailer.Transporter | null = null;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor(private readonly config: ConfigService) {
    this.fromEmail = this.config.get<string>('GMAIL_FROM_EMAIL', '');
    this.fromName = this.config.get<string>('GMAIL_FROM_NAME', 'DinnerBears');

    const user = this.config.get<string>('GMAIL_USER', '');
    const pass = this.config.get<string>('GMAIL_APP_PASSWORD', '');

    if (user && pass) {
      this.transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
      });
    }
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(payload: GmailSendPayload): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`Gmail not configured — skipping email to ${payload.toEmail}`);
      return;
    }

    await this.transporter.sendMail({
      from: `"${this.fromName}" <${this.fromEmail}>`,
      to: payload.toName
        ? `"${payload.toName}" <${payload.toEmail}>`
        : payload.toEmail,
      subject: payload.subject,
      html: payload.htmlBody ?? undefined,
      text: payload.textBody ?? undefined,
    });
  }
}
