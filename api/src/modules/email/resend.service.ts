import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma/prisma.service';

export interface ResendSendPayload {
  toEmail: string;
  toName?: string | null;
  subject: string;
  htmlBody?: string | null;
  textBody?: string | null;
}

@Injectable()
export class ResendService {
  private readonly logger = new Logger(ResendService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  private async getEffectiveConfig(): Promise<{ apiKey: string; fromEmail: string; fromName: string }> {
    const db = await this.prisma.email_provider_config.findUnique({ where: { id: 1 } });
    return {
      apiKey: db?.resendApiKey || this.config.get<string>('RESEND_API_KEY', ''),
      fromEmail: db?.resendFromEmail || this.config.get<string>('RESEND_FROM_EMAIL', 'rob@dinnerbears.com'),
      fromName: db?.resendFromName || this.config.get<string>('RESEND_FROM_NAME', 'CommunityEvents'),
    };
  }

  async isConfigured(): Promise<boolean> {
    const { apiKey } = await this.getEffectiveConfig();
    return apiKey.length > 0;
  }

  async send(payload: ResendSendPayload): Promise<void> {
    const { apiKey, fromEmail, fromName } = await this.getEffectiveConfig();

    if (!apiKey) {
      this.logger.warn(`Resend not configured — skipping email to ${payload.toEmail}`);
      return;
    }

    const to = payload.toName
      ? `${payload.toName} <${payload.toEmail}>`
      : payload.toEmail;

    const body: Record<string, unknown> = {
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject: payload.subject,
    };

    if (payload.htmlBody) body['html'] = payload.htmlBody;
    if (payload.textBody) body['text'] = payload.textBody;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Resend API error ${response.status}: ${text}`);
    }
  }
}
