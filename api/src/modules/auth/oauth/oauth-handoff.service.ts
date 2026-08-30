import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../../database/prisma/prisma.service';

/**
 * Short enough that a leaked ticket is worthless before it can be used, long
 * enough for one browser redirect between two hosts on a slow connection.
 */
const TTL_MS = 2 * 60 * 1000;

/** How long a spent or stale row is kept before an issue sweeps it. */
const RETAIN_MS = 24 * 60 * 60 * 1000;

/**
 * Carries a completed OAuth login the last hop, from the fixed callback host to
 * the community the member started on (REQ-TENANT-01.8).
 *
 * The callback cannot set the session cookie itself: cookies are host-only
 * (REQ-TENANT-01.7) and the callback is on the root host, not
 * `dayton.example.com`. So it mints a single-use ticket here, redirects to the
 * originating host with it, and that host redeems it for a cookie it can
 * actually set.
 *
 * **Every method must run inside `runWithTenant` for the originating
 * community.** `oauth_handoffs` is scoped, so the extension supplies the
 * tenant on the way in and filters on the way out -- which is what makes a
 * ticket minted for one community unredeemable on another's host, without this
 * service comparing a tenant id anywhere.
 */
@Injectable()
export class OAuthHandoffService {
  private readonly logger = new Logger(OAuthHandoffService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** SHA-256, hex. Deterministic on purpose -- the row is looked up by it. */
  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Mints a ticket for `userId`. Returns the token, which is the only time it
   * exists in readable form -- the row holds its digest.
   */
  async issue(userId: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');

    await this.prisma.oauth_handoffs.create({
      data: {
        userId,
        tokenHash: this.hash(token),
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    });

    await this.purgeStale();
    return token;
  }

  /**
   * Redeems a ticket, returning the member's id, or null if it is not
   * redeemable for any reason.
   *
   * **Single-use is enforced by the write, not by a read followed by a write.**
   * Two tabs redeeming the same token concurrently would both pass a "is it
   * consumed?" check before either marked it; a conditional `updateMany` lets
   * exactly one win, because the second matches no rows.
   */
  async redeem(token: string): Promise<number | null> {
    if (!token) return null;
    const tokenHash = this.hash(token);

    const claimed = await this.prisma.oauth_handoffs.updateMany({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    if (claimed.count !== 1) {
      this.logger.warn('An OAuth handoff token was presented that is unknown, spent or expired.');
      return null;
    }

    const row = await this.prisma.oauth_handoffs.findFirst({
      where: { tokenHash },
      select: { userId: true },
    });
    return row?.userId ?? null;
  }

  /**
   * Drops rows that can never be redeemed again.
   *
   * Done here rather than in a `@Cron` sweep deliberately: a scheduled version
   * would have to run `runUnscoped` across every community to find rows, which
   * is a waiver to maintain and a context to re-enter, for a table whose rows
   * are ~100 bytes and are only ever created by a login. Cleaning up on the
   * next issue keeps it self-limiting and needs no waiver at all. The cost is
   * that a community which stops using OAuth keeps its last day of spent
   * tickets indefinitely, which is a rounding error.
   *
   * Failure here is logged and swallowed -- a member signing in should not be
   * turned away because housekeeping could not run.
   */
  private async purgeStale(): Promise<void> {
    try {
      await this.prisma.oauth_handoffs.deleteMany({
        where: { expiresAt: { lt: new Date(Date.now() - RETAIN_MS) } },
      });
    } catch (err) {
      this.logger.warn(`Could not purge spent OAuth handoffs: ${(err as Error).message}`);
    }
  }
}
