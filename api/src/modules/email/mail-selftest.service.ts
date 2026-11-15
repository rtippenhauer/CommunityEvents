import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type { email_provider_config as EmailProviderConfig } from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { InboundEmailOutcome, MailSelfTestState, RsvpStatus } from '../../database/enums';
import { AppConfigService } from '../app-config/app-config.service';
import { AuditService } from '../audit/audit.service';
import { BrevoService } from './brevo.service';
import { EmailService } from './email.service';
import { EmailCategory } from './email.constants';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import { newEmailProviderConfig } from '../../common/email/email-config-defaults';
import { requireTenantId, runUnscoped, runWithTenant } from '../../common/tenant/tenant-store';
import { resolveQuotaTimeZone } from '../../common/email/quota-day';
import {
  foldIcsLine,
  icsEscape,
  icsSequence,
  selftestUid,
  toIcsUtcString,
} from '../../common/utils/ics.util';

/**
 * How far ahead the test entry starts, and how long it lasts.
 *
 * **+1 hour, 30 minutes long** (Rob, 2026-11-14): long enough to be a real
 * calendar entry rather than something a client might round away, short enough
 * not to clutter the operator's day. It must be in the future for a mail client
 * to offer Accept / Maybe / Decline at all -- a past event renders as a record,
 * not as an invitation.
 */
const SELFTEST_LEAD_MS = 60 * 60 * 1000;
const SELFTEST_DURATION_MS = 30 * 60 * 1000;

/** What a reply did to a community's self-test, for the inbound log to record. */
export interface SelfTestReplyResult {
  tenantId: number;
  /** The state the row is in after the reply, which is `passed` or stays `passed`. */
  state: MailSelfTestState;
  /** 1 for the reply that passed it, 2+ for an accept-then-decline. */
  replyCount: number;
  rsvpStatus: RsvpStatus;
}

/**
 * The mail-chain self-test (v2-48): one invite, to the operator's own address,
 * that answers itself.
 *
 * ## Why this exists
 *
 * A community's mail chain has five independent legs -- the Brevo key, the
 * verified sender, the template ids, the outbound DNS, and the inbound MX
 * through Cloudflare Email Routing back to `POST /calendar/rsvp-reply` -- and
 * until this, the only thing that exercised any of them was a real event
 * mailing real members. **Every email defect so far was found in production, by
 * a member.** The admin screen could say a key was *set*; nothing could say it
 * *worked*. The inbound leg is the worst of the five, because `v2-34`'s whole
 * premise is that it fails silently seven ways.
 *
 * The reply coming back is the proof. It is the only signal that traverses all
 * five legs at once, which is why `passed` is driven by the reply and by
 * nothing else.
 *
 * ## Why it cannot be aimed
 *
 * The address comes off the session user and there is **no field in the request
 * body for one**. That is a deliberate limit on the shape of the feature, not a
 * validation detail: an admin-triggered endpoint that takes an address and
 * sends a real calendar invite to it is a send tool, and this is a diagnostic.
 */
@Injectable()
export class MailSelfTestService {
  private readonly logger = new Logger(MailSelfTestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly brevo: BrevoService,
    private readonly appConfig: AppConfigService,
    private readonly tenantResolution: TenantResolutionService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Sends the invite, to the acting admin and nobody else.
   *
   * The row is written **before** the provider call, not after. A reply cannot
   * arrive before the mail does, but a reply *can* arrive before this method's
   * own continuation runs -- and a nonce that is not yet in the database when
   * the reply looks it up would be filed as `selftest_unknown`, which reads as
   * a failure of the thing being tested.
   */
  async run(actor: { id: number; email: string; fullName: string }): Promise<EmailProviderConfig> {
    const tenantId = requireTenantId('mail self-test');

    // **An unconfigured community fails loudly too, and this one is not
    // optional.** `BrevoService.send` logs "not configured -- skipping" and
    // returns normally when no key resolves, which is right for ordinary mail
    // and catastrophic here: the self-test would record `sent` and sit waiting
    // for a reply to a message that was never handed to a provider. That is
    // precisely the invisible failure this whole item exists to end, so it is
    // asked before anything is written. `isConfigured` checks the From address
    // as well as the key, because a community on its own domain brings both.
    if (!(await this.brevo.isConfigured())) {
      const message =
        'No sending credentials resolve for this community, so nothing was sent. ' +
        'Set a Brevo API key and a From address before running the check.';
      await this.fail(tenantId, actor.email, message);
      throw new BadRequestException(message);
    }

    // **A suppressed operator address fails loudly** (Rob, 2026-11-14). It is a
    // real misconfiguration worth surfacing, not a false negative -- and
    // `sendNowOrThrow` would not catch it, because the immediate path
    // deliberately bypasses the suppression list so a password reset still
    // reaches somebody who once bounced. Left to itself, the test would sit in
    // `sent` looking like a delivery fault with the provider.
    if (await this.emailService.isSuppressed(actor.email)) {
      const message =
        `${actor.email} is on this deployment's suppression list, so nothing was sent. ` +
        'Lift the suppression before running the test.';
      await this.fail(tenantId, actor.email, message);
      throw new BadRequestException(message);
    }

    // **Eight bytes, not sixteen, so the UID line cannot fold** (found on
    // stage, 2026-11-14). `UID:` + the prefix + 16 hex + the domain is 72
    // octets, inside RFC 5545's 75-octet CONTENT-LINE limit; a 32-hex nonce
    // made it 88, so the client folded it when echoing it back and the reply
    // was filed as `unknown_uid`.
    //
    // The parser was fixed to unfold -- that is the real fix, and it is in
    // `unfoldIcs`. This is the second half: do not emit a line that needs
    // folding when nothing requires it. 64 bits is ample for a value that
    // identifies a test rather than authorising anything, and a reply must
    // still arrive through the inbound route to be worth guessing.
    const nonce = randomBytes(8).toString('hex');
    const now = new Date();
    const startUtc = new Date(now.getTime() + SELFTEST_LEAD_MS);
    const endUtc = new Date(startUtc.getTime() + SELFTEST_DURATION_MS);

    const appUrl = await this.tenantResolution.baseUrlFor();
    const sendingDomain = this.hostOf(appUrl);
    const [brandName, support, organizer] = await Promise.all([
      this.appConfig.getSiteSetting('brand_name'),
      this.appConfig.supportEmail(),
      this.appConfig.calendarOrganizerEmail(),
    ]);

    // **The title names the sending domain and says it is a test** (Rob,
    // 2026-11-14). Not cosmetic: `eventUid` hardcodes the deployment's domain
    // for every tenant, so the UID cannot show whose host an invite went out
    // on. A wrong sending host is one of the defects this test is for, and the
    // subject line is where it becomes visible without reading headers.
    const subject = `[Test] ${brandName} setup check — ${sendingDomain}`;

    const ics = this.buildSelfTestIcs({
      nonce,
      subject,
      startUtc,
      endUtc,
      now,
      brandName,
      organizer,
      support,
      recipient: { name: actor.fullName, email: actor.email },
      appUrl,
    });

    await this.markSent({ tenantId, nonce, email: actor.email, sentAt: now });

    try {
      const { messageId } = await this.emailService.sendNowOrThrow({
        category: EmailCategory.OTHER,
        toEmail: actor.email,
        toName: actor.fullName,
        subject,
        htmlBody: this.buildSelfTestHtml({ brandName, sendingDomain, startUtc, support }),
        attachments: [
          {
            content: ics,
            name: 'setup-check.ics',
            contentType: 'text/calendar; method=REQUEST',
          },
        ],
      });
      if (messageId) {
        await this.prisma.email_provider_config.updateMany({
          data: { selftestMessageId: messageId },
        });
      }
    } catch (err) {
      const message = (err as Error)?.message ?? 'the send failed';
      this.logger.warn(`Mail self-test send failed for tenant ${tenantId}: ${message}`);
      await this.fail(tenantId, actor.email, message.slice(0, 500));
      // Reported rather than swallowed: the operator pressed a button and is
      // owed an answer, and a send that did not happen is the finding.
      throw new BadRequestException(`The test invite could not be sent: ${message}`);
    }

    await this.audit.log({
      userId: actor.id,
      action: 'email.selftest_sent',
      entityType: 'email_provider_config',
      metadata: { to: actor.email, sendingDomain },
    });

    return this.currentOrThrow();
  }

  /**
   * A reply arrived carrying a self-test nonce.
   *
   * **Resolves its community from the nonce with no ambient tenant**: the
   * Worker POSTs to one API_URL whatever community the mail was about, so there
   * is nothing in context to trust. `runUnscoped` to find the row, then
   * `runWithTenant` to write it -- the rule a cron composing per-tenant content
   * follows, and for the same reason.
   *
   * **A later reply is accepted, never refused.** Accept *then* Decline is a
   * supported path (Rob, 2026-11-14: "we should allow an Accept and then a
   * decline also, so we can remove it from my calendar"). Rejecting the second
   * reply as unknown would bounce the decline and leave the test entry stuck on
   * the operator's calendar -- so `passed` and `selftestPassedAt` are set once
   * and every later reply moves only the reply columns.
   */
  async recordReply(nonce: string, rsvpStatus: RsvpStatus): Promise<SelfTestReplyResult | null> {
    const row = await runUnscoped(
      'mail self-test reply: the nonce names the community, and nothing is in context',
      async () =>
        await this.prisma.email_provider_config.findFirst({
          where: { selftestNonce: nonce },
          select: { id: true, tenantId: true, selftestState: true },
        }),
    );
    if (!row) return null;

    const at = new Date();
    const alreadyPassed = row.selftestState === MailSelfTestState.PASSED;

    return runWithTenant(row.tenantId, async () => {
      const updated = await this.prisma.email_provider_config.update({
        where: { id: row.id },
        data: {
          selftestState: MailSelfTestState.PASSED,
          // Set once. The test stays replyable after it passes, and the instant
          // it passed is not the instant of the latest reply.
          ...(alreadyPassed ? {} : { selftestPassedAt: at, selftestError: null }),
          selftestLastReplyAt: at,
          selftestLastReplyStatus: rsvpStatus,
          selftestReplyCount: { increment: 1 },
        },
        select: { tenantId: true, selftestState: true, selftestReplyCount: true },
      });
      return {
        tenantId: updated.tenantId,
        state: updated.selftestState,
        replyCount: updated.selftestReplyCount,
        rsvpStatus,
      };
    });
  }

  /**
   * Brevo says the invite reached the mailbox.
   *
   * **An enrichment, and allowed to never happen.** Matched on the provider's
   * own message id rather than on the address and subject, because an
   * operator's mailbox receives this deployment's other mail too. Only a row in
   * `sent` moves: a `delivered` callback for a test that has already *passed*
   * would otherwise walk the state backwards, and Brevo's callbacks are not
   * ordered.
   */
  async recordDelivered(messageId: string | undefined): Promise<void> {
    if (!messageId) return;
    // Cross-tenant because the callback carries no community: Brevo POSTs to
    // whichever host registered the webhook, and the message id is what says
    // whose test this was. `updateMany` filtered on the id and the state, so a
    // callback about anything else is a no-op rather than a read-modify-write.
    await runUnscoped(
      'mail self-test delivery callback: the provider message id names the community',
      async () =>
        await this.prisma.email_provider_config.updateMany({
          where: { selftestMessageId: messageId, selftestState: MailSelfTestState.SENT },
          data: { selftestState: MailSelfTestState.DELIVERED, selftestDeliveredAt: new Date() },
        }),
    );
  }

  /**
   * Back to `never_run`, called when this community's Brevo key changes.
   *
   * **A passing test against a replaced key is a lie.** The new key may belong
   * to a different Brevo account entirely, with its own sender verification and
   * its own template library -- which is three of the five legs re-pointed at
   * something nothing has ever tested. The nonce goes with it, so a reply to
   * the old invite is filed as `selftest_unknown` rather than re-passing a test
   * that no longer describes this community's configuration.
   */
  resetForKeyChange(): Promise<unknown> {
    return this.prisma.email_provider_config.updateMany({
      data: {
        selftestState: MailSelfTestState.NEVER_RUN,
        selftestNonce: null,
        selftestEmail: null,
        selftestMessageId: null,
        selftestProvider: null,
        selftestSentAt: null,
        selftestDeliveredAt: null,
        selftestPassedAt: null,
        selftestLastReplyAt: null,
        selftestLastReplyStatus: null,
        selftestReplyCount: 0,
        selftestError: null,
      },
    });
  }

  /** The outcome an inbound self-test reply is logged under. */
  outcomeFor(result: SelfTestReplyResult | null): InboundEmailOutcome {
    return result ? InboundEmailOutcome.SELFTEST_REPLY : InboundEmailOutcome.SELFTEST_UNKNOWN;
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /**
   * `upsert` on the tenant, because a community that has never saved its email
   * settings has no row -- and the self-test is exactly the thing an operator
   * reaches for while setting them up. Creating it here mirrors what
   * `PATCH email/config` does on first save, for the same reason: making the
   * feature depend on the row already existing would mean the first run
   * silently did nothing.
   */
  private async markSent(input: {
    tenantId: number;
    nonce: string;
    email: string;
    sentAt: Date;
  }): Promise<void> {
    const state = {
      selftestState: MailSelfTestState.SENT,
      selftestNonce: input.nonce,
      selftestEmail: input.email,
      selftestProvider: 'brevo',
      selftestSentAt: input.sentAt,
      // Cleared, not kept: these describe the run that is being replaced.
      selftestMessageId: null,
      selftestDeliveredAt: null,
      selftestPassedAt: null,
      selftestLastReplyAt: null,
      selftestLastReplyStatus: null,
      selftestReplyCount: 0,
      selftestError: null,
    };
    // The tenant predicate is the extension's to inject on the update half and
    // ours to supply on the create half, which is what `upsert` needs a `where`
    // for at all.
    await this.prisma.email_provider_config.upsert({
      where: { tenantId: input.tenantId },
      update: state,
      create: { ...newEmailProviderConfig(), ...state },
    });
  }

  private async fail(tenantId: number, email: string, error: string): Promise<void> {
    const state = {
      selftestState: MailSelfTestState.FAILED,
      selftestEmail: email,
      selftestError: error,
    };
    await this.prisma.email_provider_config.upsert({
      where: { tenantId },
      update: state,
      create: { ...newEmailProviderConfig(), ...state },
    });
  }

  private async currentOrThrow(): Promise<EmailProviderConfig> {
    const row = await this.prisma.email_provider_config.findFirst();
    if (!row) throw new BadRequestException('This community has no email configuration.');
    return row;
  }

  // ── The invite ────────────────────────────────────────────────────────────

  /**
   * A genuine `METHOD:REQUEST`, so the mail client renders Accept / Maybe /
   * Decline.
   *
   * Built here rather than through `CalendarService.buildInviteAttachment`,
   * which takes an event row: there is no event, and inventing one -- even a
   * transient object -- is how a test ends up in an attendee list. The UID is
   * in its own namespace and carries a nonce, never an event id.
   *
   * `ORGANIZER` is the community's calendar address, which is what makes the
   * reply land back on the inbound route: a client replies to the organiser,
   * and that address is the MX the whole inbound leg hangs off.
   */
  private buildSelfTestIcs(input: {
    nonce: string;
    subject: string;
    startUtc: Date;
    endUtc: Date;
    now: Date;
    brandName: string;
    organizer: string;
    support: string;
    recipient: { name: string; email: string };
    appUrl: string;
  }): string {
    const description = [
      `This is a setup check for ${input.brandName}, sent to you and to nobody else.`,
      '',
      'Reply to this invitation from your mail client — Accept, Maybe or Decline.',
      'The reply travelling back to us is what proves this community can both',
      'send and receive calendar mail. You can Accept and then Decline to take',
      'this entry off your calendar; both replies count.',
      '',
      'No member received this, and no RSVP was recorded against any event.',
      '',
      '---',
      `Questions? Reply to ${input.support}`,
    ].join('\n');

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//${input.brandName}//${input.brandName} Calendar//EN`,
      'CALSCALE:GREGORIAN',
      'METHOD:REQUEST',
      'BEGIN:VEVENT',
      `UID:${selftestUid(input.nonce)}`,
      `DTSTAMP:${toIcsUtcString(input.now)}`,
      `DTSTART:${toIcsUtcString(input.startUtc)}`,
      `DTEND:${toIcsUtcString(input.endUtc)}`,
      `LAST-MODIFIED:${toIcsUtcString(input.now)}`,
      // Keyed on when this invite was sent, like the event invite's. Each run
      // mints a new nonce and so a new UID, but a client that still holds a
      // previous run's entry must not see a SEQUENCE that went backwards.
      `SEQUENCE:${icsSequence(input.now)}`,
      foldIcsLine(`SUMMARY:${icsEscape(input.subject)}`),
      foldIcsLine(`DESCRIPTION:${icsEscape(description)}`),
      foldIcsLine(`URL:${input.appUrl}/admin/email`),
      `ORGANIZER;CN=${icsEscape(input.brandName)}:mailto:${input.organizer}`,
      foldIcsLine(
        `ATTENDEE;CN=${icsEscape(input.recipient.name)};RSVP=TRUE:mailto:${input.recipient.email}`,
      ),
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ];

    return lines.join('\r\n');
  }

  /**
   * Plain, deliberately. The message exists to carry the invitation and to say
   * what to do with it, and it is read by one person who just pressed the
   * button that sent it.
   *
   * No provider template id is used: a template is per-account configuration
   * that may simply not exist, and a diagnostic that cannot run until the thing
   * it diagnoses is configured is no use. It also keeps this test honest about
   * what it proves -- the key, the sender and both DNS directions -- rather
   * than appearing to prove the template library as well.
   */
  private buildSelfTestHtml(input: {
    brandName: string;
    sendingDomain: string;
    startUtc: Date;
    support: string;
  }): string {
    // The operator's own calendar zone, not UTC -- v2-34's counter-proposal
    // line learned this the hard way: a time rendered correctly in UTC reads as
    // wrong beside every other time on the screen.
    const { timeZone } = resolveQuotaTimeZone(this.config.get<string>('EMAIL_QUOTA_TIMEZONE'));
    const when = input.startUtc.toLocaleString('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });

    return `<!DOCTYPE html>
<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#222;line-height:1.5">
<h1 style="font-size:1.25rem;margin:0 0 12px">${input.brandName} setup check</h1>
<p style="margin:0 0 12px">This message was sent from <strong>${input.sendingDomain}</strong> to you, and to nobody else. No member received it, and no RSVP was recorded against any event.</p>
<p style="margin:0 0 12px">Attached is a real calendar invitation for <strong>${when}</strong>. Open it and reply — <strong>Accept</strong>, <strong>Maybe</strong> or <strong>Decline</strong>.</p>
<p style="margin:0 0 12px">The reply coming back to us is the proof: it is the only signal that exercises this community's sending key, its verified sender, its outbound DNS and its inbound mail route all at once. Admin → Email will move to <strong>Passed</strong> when it arrives.</p>
<p style="margin:0 0 12px">You can Accept and then Decline to take the entry off your calendar. Both replies count, and the test stays passed.</p>
<p style="margin:0;font-size:0.85rem;color:#666">Questions? Reply to ${input.support}</p>
</body></html>`;
  }

  /** The bare host of a base URL, for the subject line. */
  private hostOf(appUrl: string): string {
    try {
      return new URL(appUrl).host;
    } catch {
      // A misconfigured base URL is itself worth seeing in the subject rather
      // than replaced by something tidy.
      return appUrl;
    }
  }
}
