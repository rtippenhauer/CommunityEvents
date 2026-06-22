import { ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
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

@Injectable()
export class ThrottlerAuditGuard extends ThrottlerGuard {
  @Inject(AuditService)
  private readonly auditService: AuditService;

  // In-memory: IP → timestamp of last rate-limit hit
  // A new audit entry is only written when the IP is seen for the first time
  // or hasn't been seen in the last 30 minutes.
  private readonly ipWindows = new Map<string, number>();

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
