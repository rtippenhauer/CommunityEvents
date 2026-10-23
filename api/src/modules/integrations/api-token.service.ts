import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma/prisma.service';
import { runUnscoped } from '../../common/tenant/tenant-store';
import { UserRole, UserStatus } from '../../database/enums';

/**
 * Bearer tokens for outside integrations (v2-29). Today only Muse holds one.
 *
 * ## The token is a credential we mint and never store
 *
 * Only the SHA-256 is kept, so a database dump cannot be replayed against the
 * API and a lost token cannot be recovered -- only reissued. That is the same
 * split `v2-9` drew between its two kinds of secret: a Brevo *API key* is
 * minted by Brevo and has to be stored and used, so it is encrypted; a webhook
 * token is **ours**, which is the only reason rotation can be automatic. This is
 * the second kind, and a hash goes further than encryption because nothing here
 * ever needs the plaintext back.
 *
 * Deliberately **not** an `encrypted-columns.ts` column. Two reasons, and the
 * second is the binding one: a hash is already irreversible, and an encrypted
 * column cannot be filtered on at all (the cipher is randomised, so the
 * extension throws rather than returning an empty result that reads as "no such
 * token") -- which is exactly the lookup the guard performs on every call.
 */
export interface IssuedToken {
  /** The plaintext, returned exactly once and never retrievable again. */
  token: string;
  prefix: string;
  expiresAt: Date;
}

export interface ApiTokenView {
  id: number;
  prefix: string;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  /** Derived, not stored -- see `isLive`. */
  live: boolean;
}

/** The row and account a presented token resolved to. */
export interface VerifiedToken {
  tokenId: number;
  tenantId: number;
  userId: number;
  role: string;
}

/**
 * `cet_` for CommunityEvents token, matching v1's Phase 39 so Muse's existing
 * handling of the prefix does not change. 32 random bytes is 256 bits; base64url
 * so the whole thing is copy-pasteable into a header and a config file with no
 * escaping.
 */
const TOKEN_PREFIX = 'cet_';
const TOKEN_BYTES = 32;

/**
 * 60 days, from v1. Long enough that rotation is not a weekly chore, short
 * enough that a token leaked into a log stops working without anybody having to
 * notice it leaked. Muse rotates its own well before this.
 */
const TOKEN_TTL_DAYS = 60;

/** The displayed stub: `cet_` plus the first 8 characters. Never authenticates. */
function prefixOf(token: string): string {
  return token.slice(0, TOKEN_PREFIX.length + 8);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Whether a row is usable right now. Derived on read rather than stored,
 * because a stored flag needs something to flip it at the moment of expiry and
 * nothing runs then -- the same reason `v2-9` derives its quota window at read
 * time, after an idle community reported a window that had closed two days
 * earlier.
 */
function isLive(row: { revokedAt: Date | null; expiresAt: Date }, now: Date): boolean {
  return row.revokedAt === null && row.expiresAt.getTime() > now.getTime();
}

@Injectable()
export class ApiTokenService {
  private readonly logger = new Logger(ApiTokenService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Mints a token for an integration account, revoking every other live token
   * it holds.
   *
   * **One live token per account, enforced here rather than by a unique index.**
   * A partial unique constraint ("at most one row where revoked_at IS NULL and
   * expires_at > now") is not expressible in MySQL, and the `expires_at` half
   * changes with the clock rather than with a write, so no index could hold it.
   * Revoking on issue is what makes the rule true, and it is also the behaviour
   * Muse needs: rotation must kill the old credential the moment the new one is
   * returned, or a compromised token stays valid for its remaining 60 days.
   *
   * In a transaction so there is no instant where both tokens are live, or --
   * if the insert fails -- where none is.
   */
  async issue(userId: number, actorId: number | null): Promise<IssuedToken> {
    const token = TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.api_tokens.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.api_tokens.create({
        data: {
          userId,
          tokenHash: hashToken(token),
          tokenPrefix: prefixOf(token),
          expiresAt,
          createdBy: actorId,
        },
      });
    });

    return { token, prefix: prefixOf(token), expiresAt };
  }

  /** Every token ever issued to an account, newest first. Never the plaintext. */
  async listForUser(userId: number): Promise<ApiTokenView[]> {
    const now = new Date();
    const rows = await this.prisma.api_tokens.findMany({
      where: { userId },
      // `createdAt` is DATETIME(6) here, so unlike the DATETIME(0) columns that
      // have produced four ordering bugs in this codebase it will not tie. The
      // id tiebreaker stays anyway: it costs nothing, and the next person
      // should not have to check a column's precision to know the order holds.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      prefix: row.tokenPrefix,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
      live: isLive(row, now),
    }));
  }

  /** Revokes one token. Idempotent: revoking an already-revoked row is a no-op. */
  async revoke(tokenId: number): Promise<void> {
    // updateMany, not update: `update` throws P2025 when the row is absent *or*
    // belongs to another community, and the scoping extension makes those two
    // indistinguishable. Guarding the count is also what caught four P2025
    // regressions in v2-3.
    const result = await this.prisma.api_tokens.updateMany({
      where: { id: tokenId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (result.count === 0) {
      // Already revoked, or not this community's token at all. The first is
      // nothing to do; the second should not quietly read as success.
      const exists = await this.prisma.api_tokens.count({ where: { id: tokenId } });
      if (exists === 0) throw new NotFoundException('No such token.');
    }
  }

  /**
   * Resolves a presented token to its account and community.
   *
   * **Runs unscoped, and that is the reason this table exists in this shape.**
   * This is the one read in the codebase that genuinely cannot be scoped: it
   * happens before any tenant is known, because an integration call carries no
   * session and we deliberately do not take its community from the Host header.
   * The row names the tenant and `MuseTenantMiddleware` enters that scope with
   * what this returns, so every later query in the request is scoped normally.
   *
   * Returns `null` for every failure rather than throwing distinguishable
   * errors, so a caller cannot tell "no such token" from "expired" from "wrong
   * role" -- the guard turns all of them into one 401. The specific reason is
   * logged instead, where only the operator can read it.
   */
  async verify(presented: string): Promise<VerifiedToken | null> {
    if (!presented.startsWith(TOKEN_PREFIX)) return null;

    return runUnscoped(
      'integration token lookup: the token names its own tenant, so there is none yet',
      async () => {
        const row = await this.prisma.api_tokens.findUnique({
          where: { tokenHash: hashToken(presented) },
          select: {
            id: true,
            tenantId: true,
            userId: true,
            expiresAt: true,
            revokedAt: true,
            user: {
              select: { role: true, status: true, tenantId: true },
            },
          },
        });

        if (row === null) return null;

        if (!isLive(row, new Date())) {
          const why = row.revokedAt === null ? 'expired' : 'revoked';
          this.logger.warn(`Integration token ${row.id} rejected: ${why}.`);
          return null;
        }

        // The role is checked **as currently held**, matching v1: flipping the
        // account to `automation` for testing disables its token until it is
        // flipped back, which is the intended off switch rather than a side
        // effect. Keyed on the role here and *not* on `is_service_account` on
        // purpose -- that column says "not a person", which is equally true of
        // Claude's automation account, and that account must not be able to
        // drive the Muse routes.
        if (row.user.role !== UserRole.MUSE) {
          this.logger.warn(
            `Integration token ${row.id} rejected: account holds role '${row.user.role}'.`,
          );
          return null;
        }

        if (row.user.status !== UserStatus.ACTIVE) {
          this.logger.warn(`Integration token ${row.id} rejected: account is ${row.user.status}.`);
          return null;
        }

        // A token whose row and whose account disagree about the community is a
        // bug upstream, not a request to serve. No current path can produce it
        // -- the token is created scoped to the account's own tenant -- which is
        // exactly why it is worth refusing loudly rather than picking one of
        // the two values and carrying on.
        if (row.user.tenantId !== row.tenantId) {
          this.logger.error(
            `Integration token ${row.id} refused: token names tenant ${row.tenantId} ` +
              `but its account belongs to ${row.user.tenantId}.`,
          );
          return null;
        }

        return {
          tokenId: row.id,
          tenantId: row.tenantId,
          userId: row.userId,
          role: row.user.role,
        };
      },
    );
  }

  /**
   * Records that a token was used. Fire-and-forget by design.
   *
   * `last_used_at` answers "has Muse actually called us since we set it up",
   * which is the question nothing can answer today and the one `v2-44`'s
   * verification checklist will want first. It must never fail a request, so the
   * error is swallowed the way the inbound log's `record()` does -- with the
   * difference `v2-34` learned the hard way: there is no foreign key here that
   * could make the write impossible in the first place.
   */
  touch(tokenId: number): void {
    void runUnscoped('integration token last-used stamp, outside any tenant', async () => {
      try {
        await this.prisma.api_tokens.updateMany({
          where: { id: tokenId },
          data: { lastUsedAt: new Date() },
        });
      } catch (error) {
        this.logger.warn(`Could not stamp last_used_at on token ${tokenId}: ${String(error)}`);
      }
    });
  }
}
