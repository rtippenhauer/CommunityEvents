import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EmailProviderConfigEntity } from '../../database/entities/email-provider-config.entity';
import { EmailTemplateName } from './email.constants';

export interface BrevoSendPayload {
  toEmail: string;
  toName?: string | null;
  subject: string;
  templateName?: EmailTemplateName;
  templateParams?: Record<string, unknown>;
  htmlBody?: string | null;
  textBody?: string | null;
}

const TEMPLATE_DB_KEY: Record<EmailTemplateName, keyof EmailProviderConfigEntity> = {
  invite: 'tmplInvite',
  security_alert: 'tmplSecurityAlert',
  event_published: 'tmplEventPublished',
  rsvp_confirmation: 'tmplRsvpConfirmation',
  event_reminder: 'tmplEventReminder',
  account_deletion_warning: 'tmplAccountDeletion',
  reengagement_60: 'tmplReengagement60',
  reengagement_90: 'tmplReengagement90',
  guest_rsvp_confirmation: 'tmplGuestRsvpConfirmation',
  email_verification: 'tmplEmailVerification',
  password_reset: 'tmplPasswordReset',
};

const TEMPLATE_ENV_KEY: Record<EmailTemplateName, string> = {
  invite: 'BREVO_TEMPLATE_INVITE',
  security_alert: 'BREVO_TEMPLATE_SECURITY_ALERT',
  event_published: 'BREVO_TEMPLATE_EVENT_PUBLISHED',
  rsvp_confirmation: 'BREVO_TEMPLATE_RSVP_CONFIRMATION',
  event_reminder: 'BREVO_TEMPLATE_EVENT_REMINDER',
  account_deletion_warning: 'BREVO_TEMPLATE_ACCOUNT_DELETION',
  reengagement_60: 'BREVO_TEMPLATE_REENGAGEMENT_60',
  reengagement_90: 'BREVO_TEMPLATE_REENGAGEMENT_90',
  guest_rsvp_confirmation: 'BREVO_TEMPLATE_GUEST_RSVP_CONFIRMATION',
  email_verification: 'BREVO_TEMPLATE_EMAIL_VERIFICATION',
  password_reset: 'BREVO_TEMPLATE_PASSWORD_RESET',
};

@Injectable()
export class BrevoService {
  private readonly logger = new Logger(BrevoService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(EmailProviderConfigEntity)
    private readonly configRepo: Repository<EmailProviderConfigEntity>,
  ) {}

  private async getEffectiveConfig(): Promise<{ apiKey: string; fromEmail: string; fromName: string }> {
    const db = await this.configRepo.findOne({ where: { id: 1 } });
    return {
      apiKey: db?.brevoApiKey || this.config.get<string>('BREVO_API_KEY', ''),
      fromEmail: db?.brevoFromEmail || this.config.get<string>('BREVO_FROM_EMAIL', 'noreply@dinnerbears.com'),
      fromName: db?.brevoFromName || this.config.get<string>('BREVO_FROM_NAME', 'DinnerBears'),
    };
  }

  private async getTemplateId(templateName: EmailTemplateName): Promise<number> {
    const db = await this.configRepo.findOne({ where: { id: 1 } });
    const dbKey = TEMPLATE_DB_KEY[templateName];
    const dbValue = db ? (db[dbKey] as number | null) : null;
    if (dbValue && dbValue > 0) return dbValue;

    const envKey = TEMPLATE_ENV_KEY[templateName];
    return parseInt(this.config.get<string>(envKey, '0'), 10);
  }

  async isConfigured(): Promise<boolean> {
    const { apiKey } = await this.getEffectiveConfig();
    return apiKey.length > 0;
  }

  async send(payload: BrevoSendPayload): Promise<void> {
    const { apiKey, fromEmail, fromName } = await this.getEffectiveConfig();

    if (!apiKey) {
      this.logger.warn(`Brevo not configured — skipping email to ${payload.toEmail}`);
      return;
    }

    const body: Record<string, unknown> = {
      sender: { email: fromEmail, name: fromName },
      to: [{ email: payload.toEmail, name: payload.toName ?? payload.toEmail }],
      subject: payload.subject,
    };

    if (payload.templateName) {
      const templateId = await this.getTemplateId(payload.templateName);
      if (templateId > 0) {
        body['templateId'] = templateId;
        body['params'] = payload.templateParams ?? {};
      } else {
        this.logger.warn(`No Brevo template ID for ${payload.templateName}`);
        if (payload.htmlBody) body['htmlContent'] = payload.htmlBody;
        if (payload.textBody) body['textContent'] = payload.textBody;
      }
    } else {
      if (payload.htmlBody) body['htmlContent'] = payload.htmlBody;
      if (payload.textBody) body['textContent'] = payload.textBody;
    }

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
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
    const { apiKey } = await this.getEffectiveConfig();
    if (!apiKey) return false;

    const url = `https://api.brevo.com/v3/contacts/blockedContacts?email=${encodeURIComponent(email)}`;
    const response = await fetch(url, {
      headers: { 'api-key': apiKey, Accept: 'application/json' },
    });

    if (response.status === 404) return false;
    if (!response.ok) return false;

    const data = (await response.json()) as { count?: number };
    return (data.count ?? 0) > 0;
  }

  async removeFromSuppressionList(email: string): Promise<void> {
    const { apiKey } = await this.getEffectiveConfig();
    if (!apiKey) return;

    const response = await fetch(
      `https://api.brevo.com/v3/contacts/blockedContacts/${encodeURIComponent(email)}`,
      {
        method: 'DELETE',
        headers: { 'api-key': apiKey },
      },
    );

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to remove ${email} from Brevo suppression list`);
    }
  }
}
