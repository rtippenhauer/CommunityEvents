import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailTemplateName, TEMPLATE_ENV_KEYS } from './email.constants';

export interface BrevoSendPayload {
  toEmail: string;
  toName?: string | null;
  subject: string;
  templateName?: EmailTemplateName;
  templateParams?: Record<string, unknown>;
  htmlBody?: string | null;
  textBody?: string | null;
}

@Injectable()
export class BrevoService {
  private readonly logger = new Logger(BrevoService.name);
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('BREVO_API_KEY', '');
  }

  get isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async send(payload: BrevoSendPayload): Promise<void> {
    if (!this.isConfigured) {
      this.logger.warn(`Brevo not configured — skipping email to ${payload.toEmail}`);
      return;
    }

    const body: Record<string, unknown> = {
      to: [{ email: payload.toEmail, name: payload.toName ?? payload.toEmail }],
      subject: payload.subject,
    };

    if (payload.templateName) {
      const envKey = TEMPLATE_ENV_KEYS[payload.templateName];
      const templateId = parseInt(this.config.get<string>(envKey, '0'), 10);
      if (templateId > 0) {
        body['templateId'] = templateId;
        body['params'] = payload.templateParams ?? {};
      } else {
        this.logger.warn(`No Brevo template ID for ${payload.templateName} (${envKey})`);
        if (payload.htmlBody) {
          body['htmlContent'] = payload.htmlBody;
        }
        if (payload.textBody) {
          body['textContent'] = payload.textBody;
        }
      }
    } else {
      if (payload.htmlBody) body['htmlContent'] = payload.htmlBody;
      if (payload.textBody) body['textContent'] = payload.textBody;
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Brevo API error ${response.status}: ${text}`);
    }
  }

  async isSuppressed(email: string): Promise<boolean> {
    if (!this.isConfigured) return false;

    const url = `https://api.brevo.com/v3/contacts/blockedContacts?email=${encodeURIComponent(email)}`;
    const response = await fetch(url, {
      headers: { 'api-key': this.apiKey, Accept: 'application/json' },
    });

    if (response.status === 404) return false;
    if (!response.ok) return false;

    const data = (await response.json()) as { count?: number };
    return (data.count ?? 0) > 0;
  }

  async removeFromSuppressionList(email: string): Promise<void> {
    if (!this.isConfigured) return;

    const response = await fetch(
      `https://api.brevo.com/v3/contacts/blockedContacts/${encodeURIComponent(email)}`,
      {
        method: 'DELETE',
        headers: { 'api-key': this.apiKey },
      },
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to remove ${email} from Brevo suppression list`);
    }
  }
}
