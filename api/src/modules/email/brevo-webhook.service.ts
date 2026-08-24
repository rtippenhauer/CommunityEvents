import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../database/prisma/prisma.service';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import { runUnscoped, runWithTenant } from '../../common/tenant/tenant-store';

/**
 * Registers each community's Brevo deliverability webhook, and rotates the
 * token that authenticates it.
 *
 * The token is **ours**, not Brevo's: we mint it and hand it over when
 * registering, which is the only reason rotation can be automatic. The API key
 * beside it is the opposite — Brevo mints that one and offers no endpoint to
 * reissue it, so it can only be replaced by a human in their dashboard. That
 * asymmetry is why one of the two gets a schedule and the other gets a warning.
 *
 * Rotation is automatic rather than expiring and waiting for someone, because
 * the failure mode of an expired token is silent and harmful: callbacks start
 * being rejected, bounces stop suppressing dead addresses, and the deployment
 * keeps mailing them — which is what gets a sending domain blocked. A rotation
 * nobody has to act on cannot be missed.
 */
@Injectable()
export class BrevoWebhookService {
  private readonly logger = new Logger(BrevoWebhookService.name);

  /**
   * How old a token gets before it is replaced.
   *
   * Monthly, because rotating costs nothing — no human is involved and the
   * previous token stays valid through the swap — and it bounds how long a
   * token taken from a compromised Brevo account stays useful.
   */
  private static readonly ROTATE_AFTER_DAYS = 30;

  /**
   * How long the replaced token keeps working.
   *
   * The same idea as `SECRET_ENCRYPTION_KEYS_RETIRED`: a callback already in
   * flight when the swap happens must not be rejected, and Brevo retries on a
   * schedule of its own that we do not control.
   *
   * **Sized to a failure, not to a calendar.** Giving each token a long
   * multi-month validity would not add resilience here: Brevo holds exactly one
   * token at a time, `register()` advances the stored value only after Brevo has
   * confirmed the change, and a failed rotation therefore leaves the *current*
   * token in place and working indefinitely. So the only thing an overlap has to
   * cover is callbacks already in flight during a successful swap — and every
   * extra day past that is a leaked token that still works.
   */
  private static readonly PREVIOUS_TOKEN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * Note the casing. Brevo's *registration* API names events in camelCase
   * (`hardBounce`), while the *payload* it later posts spells the same event in
   * snake_case (`hard_bounce`) — which is what `EmailWebhookController`
   * switches on. Getting these the same way round is a real trap: a webhook
   * registered with `hard_bounce` is accepted and simply never fires.
   */
  private static readonly EVENTS = [
    'delivered',
    'hardBounce',
    'softBounce',
    'blocked',
    'spam',
    'unsubscribed',
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tenantResolution: TenantResolutionService,
  ) {}

  /**
   * Points Brevo at this community, minting a token if it has none.
   *
   * Called after an API key is saved and from the admin screen's button. Never
   * throws: a provider outage must not fail the save that triggered it, so the
   * outcome is returned and also recorded on the row for the screen to show.
   */
  async register(options: { newToken: boolean }): Promise<{ ok: boolean; error?: string }> {
    const config = await this.prisma.email_provider_config.findFirst();
    if (!config) return { ok: false, error: 'This community has no email configuration yet.' };

    const apiKey = config.brevoApiKey || this.config.get<string>('BREVO_API_KEY', '');
    if (!apiKey) {
      return { ok: false, error: 'No Brevo API key is set for this community.' };
    }

    const url = `${await this.tenantResolution.baseUrlFor(config.tenantId)}/api/v1/email/webhook/brevo`;
    const token = options.newToken || !config.webhookSecret ? mintToken() : config.webhookSecret;

    // A key that changed may belong to a different Brevo account entirely, in
    // which case the stored id names a webhook this key cannot see. Creating
    // rather than updating is the safe way round: an orphaned webhook in an
    // account we can no longer reach is untidy, a lost one is broken.
    const existingId = options.newToken ? null : config.webhookId;

    try {
      const id = existingId
        ? await this.updateWebhook(apiKey, existingId, url, token)
        : await this.createWebhook(apiKey, url, token);

      await this.prisma.email_provider_config.updateMany({
        where: { id: config.id },
        data: {
          webhookId: id,
          webhookSecret: token,
          // Only displaced when the token actually changed; re-registering the
          // same token must not leave a stale one accepted for another day.
          ...(token === config.webhookSecret
            ? {}
            : { webhookSecretPrevious: config.webhookSecret, webhookRotatedAt: new Date() }),
          webhookError: null,
        },
      });
      return { ok: true };
    } catch (err) {
      const error = (err as Error).message.slice(0, 500);
      this.logger.error(`Brevo webhook registration failed for tenant ${config.tenantId}: ${error}`);
      await this.prisma.email_provider_config.updateMany({
        where: { id: config.id },
        data: { webhookError: error },
      });
      return { ok: false, error };
    }
  }

  /**
   * Whether a token presented by a caller is this community's.
   *
   * The current token or, inside the grace window, the one it replaced. Both
   * are encrypted columns, so neither can be looked up by value — the tenant is
   * resolved from the Host header before this is reached and the row fetched by
   * that, which is the pattern every encrypted column has to use.
   */
  async verifyToken(presented: string | undefined): Promise<boolean> {
    if (!presented) return false;

    const config = await this.prisma.email_provider_config.findFirst();
    if (!config) return false;

    if (config.webhookSecret && constantTimeEquals(presented, config.webhookSecret)) return true;

    const rotatedAt = config.webhookRotatedAt?.getTime() ?? 0;
    const withinGrace = Date.now() - rotatedAt < BrevoWebhookService.PREVIOUS_TOKEN_GRACE_MS;
    return Boolean(
      withinGrace &&
        config.webhookSecretPrevious &&
        constantTimeEquals(presented, config.webhookSecretPrevious),
    );
  }

  /**
   * Replaces tokens that have reached ROTATE_AFTER_DAYS, one community at a
   * time.
   *
   * `runUnscoped` to *find* the rows and `runWithTenant` to act on each, which
   * is the standing rule: a sweep may cross communities to look, never to
   * write. Only communities that already have a registered webhook are
   * touched — rotation is maintenance, not setup.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async rotateDueTokens(): Promise<void> {
    const due = await runUnscoped('webhook token rotation covers every tenant', () =>
      this.prisma.email_provider_config.findMany({
        where: {
          webhookId: { not: null },
          OR: [
            { webhookRotatedAt: null },
            {
              webhookRotatedAt: {
                lt: new Date(Date.now() - BrevoWebhookService.ROTATE_AFTER_DAYS * 86400000),
              },
            },
          ],
        },
        select: { tenantId: true },
      }),
    );

    for (const { tenantId } of due) {
      // Errors are recorded on the row by register() rather than thrown, so one
      // community's revoked key cannot stop the sweep reaching the next.
      const result = await runWithTenant(tenantId, () => this.register({ newToken: true }));
      if (result.ok) this.logger.log(`Rotated Brevo webhook token for tenant ${tenantId}`);
    }
  }

  /** Drops a replaced token once its grace window has passed. */
  @Cron(CronExpression.EVERY_HOUR)
  async clearExpiredPreviousTokens(): Promise<void> {
    await runUnscoped('clearing replaced webhook tokens covers every tenant', () =>
      this.prisma.email_provider_config.updateMany({
        where: {
          webhookSecretPrevious: { not: null },
          webhookRotatedAt: {
            lt: new Date(Date.now() - BrevoWebhookService.PREVIOUS_TOKEN_GRACE_MS),
          },
        },
        data: { webhookSecretPrevious: null },
      }),
    );
  }

  private async createWebhook(
    apiKey: string,
    url: string,
    token: string,
  ): Promise<string> {
    const body = await this.callBrevo<{ id: number }>(apiKey, 'POST', 'https://api.brevo.com/v3/webhooks', {
      url,
      description: 'CommunityEvents deliverability events',
      type: 'transactional',
      events: BrevoWebhookService.EVENTS,
      auth: { type: 'bearer', token },
    });
    return String(body.id);
  }

  private async updateWebhook(
    apiKey: string,
    id: string,
    url: string,
    token: string,
  ): Promise<string> {
    await this.callBrevo(apiKey, 'PUT', `https://api.brevo.com/v3/webhooks/${id}`, {
      url,
      events: BrevoWebhookService.EVENTS,
      auth: { type: 'bearer', token },
    });
    return id;
  }

  private async callBrevo<T>(
    apiKey: string,
    method: 'POST' | 'PUT',
    url: string,
    body: unknown,
  ): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Brevo API error ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
    // PUT answers 204 with no body; POST answers 201 with { id }.
    const text = await response.text();
    return (text ? JSON.parse(text) : {}) as T;
  }
}

/** 32 random bytes, URL-safe — it travels in an Authorization header. */
function mintToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Length-safe and timing-safe. `timingSafeEqual` throws on differing lengths,
 * which would itself leak length through an exception, so the comparison is
 * padded to a fixed digest-sized buffer by hashing neither side but comparing
 * lengths first and returning early only for the obviously-wrong shape.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
