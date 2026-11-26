import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma/prisma.service';
import { requireTenantId } from '../../common/tenant/tenant-store';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import { EMAIL_SEND_TIMEOUT_MS } from './email.constants';
import type { EmailAttachment } from './brevo.service';

export interface ResendSendPayload {
  toEmail: string;
  toName?: string | null;
  subject: string;
  htmlBody?: string | null;
  textBody?: string | null;
  /**
   * Added by `v2-50`. Resend has always supported attachments; this service
   * simply never sent them, so **a message that overflowed to Resend arrived
   * without its calendar invite** while the identical message on Brevo carried
   * one. Nothing reported it: overflow is by definition the busy day, and the
   * send itself succeeded.
   */
  attachments?: EmailAttachment[];
}

@Injectable()
export class ResendService {
  private readonly logger = new Logger(ResendService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tenantResolution: TenantResolutionService,
  ) {}

  private async getEffectiveConfig(): Promise<{ apiKey: string; fromEmail: string; fromName: string }> {
    // Per-community as of v2-9, and gated on whose domain the community is on
    // as of v2-12 -- see BrevoService.getEffectiveConfig for both. The overflow
    // provider follows the primary one exactly: a community that may not send
    // on the deployment's Brevo account may not overflow onto its Resend
    // account either, or the rule would hold only until the first busy day.
    const db = await this.prisma.email_provider_config.findFirst();

    const tenantId = requireTenantId('resolving this community for overflow email sending');
    const mayFallBack = await this.tenantResolution.isOnDeploymentDomain(tenantId);
    const env = mayFallBack
      ? {
          apiKey: this.config.get<string>('RESEND_API_KEY', ''),
          fromEmail: this.config.get<string>('RESEND_FROM_EMAIL', 'noreply@communityeventsproject.com'),
          fromName: this.config.get<string>('RESEND_FROM_NAME', 'CommunityEvents'),
        }
      : { apiKey: '', fromEmail: '', fromName: '' };

    return {
      apiKey: db?.resendApiKey || env.apiKey,
      fromEmail: db?.resendFromEmail || env.fromEmail,
      fromName: db?.resendFromName || env.fromName,
    };
  }

  async isConfigured(): Promise<boolean> {
    const { apiKey, fromEmail } = await this.getEffectiveConfig();
    // Both required, as in BrevoService.isConfigured -- see the note there.
    return apiKey.length > 0 && fromEmail.length > 0;
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

    // Resend takes `filename`, where Brevo takes `name` -- the one difference
    // worth noting, because a wrong key here is accepted and silently ignored
    // rather than rejected. Base64, as Brevo's does, since the stored content
    // is decoded text (see the migration note on email_queue.attachments).
    //
    // `contentType` is deliberately not forwarded, and neither does the Brevo
    // path forward it: both providers infer the MIME type from the extension,
    // and for a calendar invite the METHOD that matters is the one INSIDE the
    // .ics, which is what clients read. Sending `text/calendar; method=CANCEL`
    // as a header while the body said REQUEST would be the dangerous case, and
    // it cannot arise while neither provider is told.
    if (payload.attachments?.length) {
      body['attachments'] = payload.attachments.map((a) => ({
        filename: a.name,
        content: Buffer.from(a.content, 'utf-8').toString('base64'),
      }));
    }

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      // Bounded for the same reason as the Brevo send: the dispatcher holds a
      // claim on the row for as long as this call runs, and the stale-claim
      // sweep's cutoff is only safe if that duration has a ceiling. See
      // EMAIL_SEND_TIMEOUT_MS in email.constants.ts.
      signal: AbortSignal.timeout(EMAIL_SEND_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Resend API error ${response.status}: ${text}`);
    }
  }
}
