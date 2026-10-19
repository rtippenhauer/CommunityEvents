import { describe, it, expect } from 'vitest';
import { compareForAdminList } from './releases.service';

/**
 * The admin list used to order by `createdAt` while the screen displays
 * `publishedAt`, so the column shown and the column sorted disagreed. Found on
 * stage 2026-10-18: a 2.0.0 drafted weeks earlier and published that day sat
 * below three notes imported after it, the dates reading 15th, 15th, 15th,
 * 18th.
 */
describe('compareForAdminList', () => {
  const rel = (id: number, publishedAt: string | null) => ({
    id,
    publishedAt: publishedAt === null ? null : new Date(publishedAt),
  });

  const sorted = (rows: ReturnType<typeof rel>[]) =>
    [...rows].sort(compareForAdminList).map((r) => r.id);

  it('puts drafts first, however old they are', () => {
    const draft = rel(1, null);
    const publishedToday = rel(2, '2026-10-19T00:00:00Z');
    expect(sorted([publishedToday, draft])).toEqual([1, 2]);
  });

  it('orders published releases newest-first by publish date, not creation', () => {
    // Lower id, later publish date: the case that was wrong on stage.
    const draftedLongAgoPublishedToday = rel(165, '2026-10-19T02:50:27Z');
    const importedLater = rel(188, '2026-10-16T00:57:54Z');
    expect(sorted([importedLater, draftedLongAgoPublishedToday])).toEqual([165, 188]);
  });

  it('breaks DATETIME(0) ties on id, as the member-facing queries do', () => {
    // The notes importer writes every file with NOW() in one pass.
    const a = rel(186, '2026-10-16T00:57:54Z');
    const b = rel(187, '2026-10-16T00:57:54Z');
    const c = rel(188, '2026-10-16T00:57:54Z');
    expect(sorted([a, c, b])).toEqual([188, 187, 186]);
  });

  it('orders several drafts among themselves by id, newest first', () => {
    expect(sorted([rel(4, null), rel(9, null), rel(7, null)])).toEqual([9, 7, 4]);
  });

  it('is a total order: sorting is stable whatever the input order', () => {
    const rows = [
      rel(165, '2026-10-19T02:50:27Z'),
      rel(188, '2026-10-16T00:57:54Z'),
      rel(186, '2026-10-16T00:57:54Z'),
      rel(99, null),
      rel(1, '2026-08-16T16:46:38Z'),
    ];
    const expected = [99, 165, 188, 186, 1];
    expect(sorted(rows)).toEqual(expected);
    expect(sorted([...rows].reverse())).toEqual(expected);
  });
});
