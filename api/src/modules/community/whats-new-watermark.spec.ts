import { describe, it, expect, vi } from 'vitest';
import { isAfterWatermark, WhatsNewService } from './whats-new.service';
import { PrismaService } from '../../database/prisma/prisma.service';

/**
 * Unpublishing a release re-announced an older one to every member.
 *
 * `getUnseen` asked `latestRelease.id !== user.lastSeenReleaseId`, which is
 * only the same question as "have you seen it" while the latest row can never
 * change to an older one. `releases.unpublish` sets `published_at` back to
 * NULL, and ids follow import order rather than publish order, so the release
 * that becomes latest again has the HIGHER id: dismissed 2.0.0 (id 165), the
 * query returns 1.6.3 (id 188), and 188 !== 165 reads as unseen.
 */
describe('isAfterWatermark', () => {
  const v200 = { id: 165, publishedAt: new Date('2026-10-19T02:50:27Z') };
  const v163 = { id: 188, publishedAt: new Date('2026-10-16T00:57:54Z') };

  it('is the regression: an older release does not resurface after an unpublish', () => {
    // The member dismissed 2.0.0, so the watermark is its publish date.
    const seen = { seenAt: v200.publishedAt, seenId: v200.id };
    // 2.0.0 is unpublished, so 1.6.3 is latest again -- with the higher id.
    expect(isAfterWatermark(v163, seen)).toBe(false);
  });

  it('still shows a release newer than the watermark', () => {
    const seen = { seenAt: v163.publishedAt, seenId: v163.id };
    expect(isAfterWatermark(v200, seen)).toBe(true);
  });

  it('does not re-show the very release the watermark names', () => {
    expect(isAfterWatermark(v200, { seenAt: v200.publishedAt, seenId: v200.id })).toBe(false);
  });

  it('breaks DATETIME(0) ties on id, as the member-facing query orders by', () => {
    // The notes importer writes every file with NOW() in one pass.
    const at = new Date('2026-10-16T00:57:54Z');
    expect(isAfterWatermark({ id: 188, publishedAt: at }, { seenAt: at, seenId: 187 })).toBe(true);
    expect(isAfterWatermark({ id: 186, publishedAt: at }, { seenAt: at, seenId: 187 })).toBe(false);
  });

  it('falls back to the old id check when there is no date to compare', () => {
    // A member whose dismissed release was already unpublished when the
    // backfill ran: no watermark exists, so behaviour is exactly as before
    // rather than "everything is unseen", which would splash the whole
    // community once on deploy.
    expect(isAfterWatermark(v163, { seenAt: null, seenId: v163.id })).toBe(false);
    expect(isAfterWatermark(v163, { seenAt: null, seenId: 165 })).toBe(true);
    expect(isAfterWatermark(v163, { seenAt: null, seenId: null })).toBe(true);
  });
});

describe('WhatsNewService.markReleaseSeen', () => {
  const v200 = { id: 165, publishedAt: new Date('2026-10-19T02:50:27Z') };
  const v163 = { id: 188, publishedAt: new Date('2026-10-16T00:57:54Z') };

  const serviceWith = (
    release: { id: number; publishedAt: Date | null } | null,
    user: { lastSeenReleaseAt: Date | null; lastSeenReleaseId: number | null },
  ) => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      releases: { findUnique: vi.fn().mockResolvedValue(release) },
      users: { findUnique: vi.fn().mockResolvedValue(user), update },
    } as unknown as PrismaService;
    return { service: new WhatsNewService(prisma), update };
  };

  it('writes the id and the date together', async () => {
    const { service, update } = serviceWith(v200, { lastSeenReleaseAt: null, lastSeenReleaseId: null });
    await service.markReleaseSeen(7, v200.id);
    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { lastSeenReleaseId: v200.id, lastSeenReleaseAt: v200.publishedAt },
    });
  });

  it('never moves the watermark backwards', async () => {
    // Dismissing an older release must not leave the newer date beside the
    // older id: that pair never existed, and the tie branch would then read
    // the genuinely-seen latest release as unseen again.
    const { service, update } = serviceWith(v163, {
      lastSeenReleaseAt: v200.publishedAt,
      lastSeenReleaseId: v200.id,
    });
    await service.markReleaseSeen(7, v163.id);
    expect(update).not.toHaveBeenCalled();
  });

  it('records nothing for a release that is not published', async () => {
    const { service, update } = serviceWith(
      { id: 200, publishedAt: null },
      { lastSeenReleaseAt: v200.publishedAt, lastSeenReleaseId: v200.id },
    );
    await service.markReleaseSeen(7, 200);
    expect(update).not.toHaveBeenCalled();
  });

  it('heals a row the backfill could not reconstruct', async () => {
    // No watermark, and the pointer already names this release: the old code
    // had nothing more to write, but the date is still missing.
    const { service, update } = serviceWith(v200, {
      lastSeenReleaseAt: null,
      lastSeenReleaseId: v200.id,
    });
    await service.markReleaseSeen(7, v200.id);
    expect(update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { lastSeenReleaseId: v200.id, lastSeenReleaseAt: v200.publishedAt },
    });
  });
});
