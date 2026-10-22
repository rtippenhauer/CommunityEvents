import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';
import { AuditService } from '../../modules/audit/audit.service';
import { InboundEmailLogService } from '../../modules/email/inbound-email-log.service';
import { InboundEmailOutcome } from '../../database/enums';
import { clientIpFrom } from '../utils/client-ip.util';

interface ThrottlerDetail {
  limit: number;
  ttl: number;
  totalHits: number;
  key: string;
  tracker: string;
}

// 30 minutes — matches the bad-password stale counter window
const WINDOW_MS = 30 * 60 * 1000;

// Default write-operation ceiling (create/update/delete). Routes that already
// declare an explicit @Throttle() keep their own limit — this only fills in
// the gap for the many write routes that never got one and were otherwise
// falling through to the far looser global read default.
const WRITE_LIMIT = 30;
const WRITE_TTL = 60000;
const NON_MUTATING_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class ThrottlerAuditGuard extends ThrottlerGuard {
  @Inject(AuditService)
  private readonly auditService: AuditService;

  /**
   * Property injection like `auditService` above, and for the same reason: this
   * is a globally-registered guard, so Nest constructs it outside any module's
   * provider list and a constructor parameter would not resolve.
   */
  @Inject(InboundEmailLogService)
  private readonly inboundLog: InboundEmailLogService;

  // In-memory: IP → timestamp of last rate-limit hit
  // A new audit entry is only written when the IP is seen for the first time
  // or hasn't been seen in the last 30 minutes.
  private readonly ipWindows = new Map<string, number>();

  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const { context, throttler } = requestProps;
    const req = context.switchToHttp().getRequest<{ method?: string }>();
    const method = req.method ?? 'GET';

    // No public API exposes "did this route declare an explicit @Throttle()".
    // But canActivate() only ever passes through the module-level default
    // (namedThrottler.limit) when no route/class override was found, so a
    // resolved limit equal to the configured default means this route is
    // relying on the global default rather than its own @Throttle().
    const isUsingGlobalDefault = requestProps.limit === throttler.limit;

    if (!NON_MUTATING_METHODS.has(method) && isUsingGlobalDefault) {
      requestProps.limit = WRITE_LIMIT;
      requestProps.ttl = WRITE_TTL;
    }

    return super.handleRequest(requestProps);
  }

  protected override async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerDetail,
  ): Promise<void> {
    const req = context.switchToHttp().getRequest<{
      ip?: string;
      url?: string;
      originalUrl?: string;
      headers?: Record<string, string | string[] | undefined>;
      socket?: { remoteAddress?: string };
      tenant?: { id: number };
    }>();
    // `clientIpFrom` rather than `req.ip`: behind Cloudflare the latter is the
    // edge node, so every caller looked like the same one. The audit entry
    // below gets the better value too -- it has always meant "who did this".
    const ip = clientIpFrom(req) ?? 'unknown';
    const now = Date.now();

    // The inbound mail endpoint gets its row in the inbound log as well as the
    // audit entry below (v2-34). Both, not one: `audit_log` is the deployment's
    // history of who did what, while the inbound log is the one screen somebody
    // debugging "why did this member's RSVP not arrive" actually opens — and a
    // throttled request never reaches the handler, so this guard is the only
    // place that can say it happened.
    //
    // Scoped to the one path rather than written for every throttled route,
    // deliberately: the generic behaviour below serves the whole deployment and
    // should not change to suit one endpoint.
    const path = req.originalUrl ?? req.url ?? '';
    if (path.includes('/calendar/rsvp-reply')) {
      // A throttle row always HAS a tenant: TenantMiddleware runs ahead of the
      // guards and 404s an unknown host, so anything reaching here resolved
      // one. The tenantless rows come from a message resolving to no
      // community, never from this path.
      await this.inboundLog.record({
        outcome: InboundEmailOutcome.RATE_LIMITED,
        detail: `refused after ${throttlerLimitDetail.limit} requests in ${Math.round(throttlerLimitDetail.ttl / 1000)}s`,
        tenantId: req.tenant?.id ?? null,
        storeBody: false,
        sizeBytes: 0,
        sourceIp: ip,
      });
    }

    const lastHit = this.ipWindows.get(ip) ?? 0;
    const isNewWindow = now - lastHit > WINDOW_MS;

    // Slide the window forward on every hit
    this.ipWindows.set(ip, now);

    if (isNewWindow) {
      void this.auditService.log({
        action: 'auth.rate_limited',
        ipAddress: ip,
        metadata: { path: req.url ?? '', limit: throttlerLimitDetail.limit },
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return super.throwThrottlingException(context, throttlerLimitDetail as any);
  }
}
