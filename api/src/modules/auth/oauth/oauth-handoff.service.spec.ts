import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { OAuthHandoffService } from './oauth-handoff.service';
import type { PrismaService } from '../../../database/prisma/prisma.service';

interface Row {
  userId: number;
  tokenHash: string;
  consumedAt: Date | null;
  expiresAt: Date;
}

/**
 * An in-memory stand-in for the one table this service touches.
 *
 * `updateMany` is modelled faithfully — it applies the whole `where` and
 * reports how many rows matched — because single-use here rests entirely on
 * that count, not on a read the service performs first.
 */
function stubPrisma(rows: Row[] = []) {
  const deleted: Row[] = [];
  const prisma = {
    oauth_handoffs: {
      create: ({ data }: { data: Omit<Row, 'consumedAt'> }) => {
        rows.push({ ...data, consumedAt: null });
        return Promise.resolve(data);
      },
      updateMany: ({
        where,
        data,
      }: {
        where: { tokenHash: string; consumedAt: null; expiresAt: { gt: Date } };
        data: { consumedAt: Date };
      }) => {
        const matched = rows.filter(
          (row) =>
            row.tokenHash === where.tokenHash &&
            row.consumedAt === null &&
            row.expiresAt > where.expiresAt.gt,
        );
        matched.forEach((row) => (row.consumedAt = data.consumedAt));
        return Promise.resolve({ count: matched.length });
      },
      findFirst: ({ where }: { where: { tokenHash: string } }) =>
        Promise.resolve(rows.find((row) => row.tokenHash === where.tokenHash) ?? null),
      deleteMany: ({ where }: { where: { expiresAt: { lt: Date } } }) => {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].expiresAt < where.expiresAt.lt) deleted.push(...rows.splice(i, 1));
        }
        return Promise.resolve({ count: deleted.length });
      },
    },
  } as unknown as PrismaService;
  return { prisma, rows, deleted };
}

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

describe('OAuthHandoffService (REQ-TENANT-01.8)', () => {
  it('issues a ticket and redeems it once', async () => {
    const { prisma } = stubPrisma();
    const service = new OAuthHandoffService(prisma);

    const token = await service.issue(42);
    expect(await service.redeem(token)).toBe(42);
  });

  // The property the whole table exists for. A replayable ticket in a URL is a
  // session in a URL.
  it('refuses a second redemption of the same ticket', async () => {
    const { prisma } = stubPrisma();
    const service = new OAuthHandoffService(prisma);
    vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

    const token = await service.issue(42);
    expect(await service.redeem(token)).toBe(42);
    expect(await service.redeem(token)).toBeNull();
  });

  // Two tabs redeeming at once would both pass a read-then-write check.
  it('lets exactly one of two concurrent redemptions win', async () => {
    const { prisma } = stubPrisma();
    const service = new OAuthHandoffService(prisma);
    vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

    const token = await service.issue(7);
    const results = await Promise.all([service.redeem(token), service.redeem(token)]);

    expect(results.filter((r) => r === 7)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
  });

  it('never stores the token itself', async () => {
    const { prisma, rows } = stubPrisma();
    const token = await new OAuthHandoffService(prisma).issue(1);

    expect(rows[0].tokenHash).toBe(hashOf(token));
    expect(rows[0].tokenHash).not.toContain(token);
  });

  it('refuses an expired ticket', async () => {
    const expired: Row = {
      userId: 5,
      tokenHash: hashOf('stale-token'),
      consumedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    };
    const { prisma } = stubPrisma([expired]);
    const service = new OAuthHandoffService(prisma);
    vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

    expect(await service.redeem('stale-token')).toBeNull();
  });

  it.each([['unknown', 'never-issued'], ['empty', '']])(
    'refuses an %s token',
    async (_label, token) => {
      const { prisma } = stubPrisma();
      const service = new OAuthHandoffService(prisma);
      vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

      expect(await service.redeem(token)).toBeNull();
    },
  );

  it('sweeps tickets that can never be redeemed again', async () => {
    const ancient: Row = {
      userId: 5,
      tokenHash: hashOf('ancient'),
      consumedAt: null,
      expiresAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
    };
    const { prisma, deleted } = stubPrisma([ancient]);

    await new OAuthHandoffService(prisma).issue(1);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].tokenHash).toBe(hashOf('ancient'));
  });

  // Housekeeping must not turn a member away.
  it('still issues when the sweep fails', async () => {
    const { prisma } = stubPrisma();
    vi.spyOn(prisma.oauth_handoffs, 'deleteMany').mockRejectedValue(new Error('deadlock'));
    const service = new OAuthHandoffService(prisma);
    vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);

    await expect(service.issue(1)).resolves.toBeTypeOf('string');
  });
});
