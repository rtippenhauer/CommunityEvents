import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';
import { AuditService } from '../../modules/audit/audit.service';

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
    const req = context.switchToHttp().getRequest<{ ip?: string; url?: string; socket?: { remoteAddress?: string } }>();
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const now = Date.now();

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
