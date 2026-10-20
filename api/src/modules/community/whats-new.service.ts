import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { AnnouncementStatus } from '../../database/enums';

export interface WhatsNewRelease {
  id: number;
  version: string;
  title: string;
  body: string;
  publishedAt: Date;
}

export interface WhatsNewAnnouncement {
  id: number;
  title: string;
  body: string;
  publishedAt: Date;
}

/**
 * How far through the published list a member has been shown: the publish date
 * of the newest item they dismissed, plus its id to break DATETIME(0) ties.
 *
 * The two move together or not at all -- see `advanceWatermark`.
 */
export interface SeenWatermark {
  seenAt: Date | null;
  seenId: number | null;
}

/**
 * Is `candidate` newer than the watermark, in the order members experience?
 *
 * This replaces `latest.id !== user.lastSeenReleaseId`, which was only the same
 * question while the latest row could never change to an OLDER one. It can:
 * `releases.unpublish` sets `published_at` back to NULL, so unpublishing 2.0.0
 * makes 1.6.3 latest again -- and because ids follow import order rather than
 * publish order, the older release has the HIGHER id. A member who dismissed
 * 2.0.0 held 165, the query returned 188, and `188 !== 165` re-announced a
 * release the whole community had already read. Deleting the newest release
 * does the same with no unpublishing involved.
 *
 * The comparison is the tuple `(publishedAt, id)` the member-facing queries
 * already order by, so the id still breaks ties among notes the importer
 * published in the same second -- it just stops carrying the whole decision.
 */
export function isAfterWatermark(
  candidate: { id: number; publishedAt: Date },
  watermark: SeenWatermark,
): boolean {
  // No date to compare: either the member has dismissed nothing, or the row
  // their pointer names was already unpublished when the backfill ran. Fall
  // back to the old id check rather than declaring everything unseen, which
  // would splash every member once on deploy.
  if (!watermark.seenAt) return candidate.id !== watermark.seenId;

  const seen = watermark.seenAt.getTime();
  const published = candidate.publishedAt.getTime();
  if (published !== seen) return published > seen;
  return candidate.id > (watermark.seenId ?? 0);
}

// Post-login "what's new" splash — releases/announcements side of it
// (achievements have their own seen-tracking in AchievementsService). Each
// user carries a watermark (users.last_seen_release_at/last_seen_release_id and
// the announcement pair) marking the newest one they've been shown, so there's
// never a backlog — only the single latest unseen release and/or announcement,
// one of each at most.
@Injectable()
export class WhatsNewService {
  constructor(private readonly prisma: PrismaService) {}

  async getUnseen(
    userId: number,
  ): Promise<{ release: WhatsNewRelease | null; announcement: WhatsNewAnnouncement | null }> {
    const user = await this.prisma.users.findUnique({ where: { id: userId } });
    if (!user) return { release: null, announcement: null };

    const latestRelease = await this.prisma.releases.findFirst({
      where: { publishedAt: { not: null } },
      // published_at is DATETIME(0) and the notes importer writes every file
      // with NOW() in one pass, so a boot importing several notes gives them
      // all the same second. Without the id tiebreaker "latest" is whatever
      // the engine returns -- v2-31's pagination tie in a new place. The
      // importer inserts in version order, so the highest id is the newest.
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    });
    const release =
      latestRelease &&
      isAfterWatermark(
        { id: latestRelease.id, publishedAt: latestRelease.publishedAt! },
        { seenAt: user.lastSeenReleaseAt, seenId: user.lastSeenReleaseId },
      )
        ? {
            id: latestRelease.id,
            version: latestRelease.version,
            title: latestRelease.title,
            body: latestRelease.body,
            publishedAt: latestRelease.publishedAt!,
          }
        : null;

    const latestAnnouncement = await this.prisma.announcements.findFirst({
      where: { status: AnnouncementStatus.PUBLISHED },
      // Same DATETIME(0) tie as releases above, less exposed only because
      // announcements are published one at a time by hand.
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    });
    const announcement =
      latestAnnouncement &&
      isAfterWatermark(
        { id: latestAnnouncement.id, publishedAt: latestAnnouncement.publishedAt! },
        { seenAt: user.lastSeenAnnouncementAt, seenId: user.lastSeenAnnouncementId },
      )
        ? {
            id: latestAnnouncement.id,
            title: latestAnnouncement.title,
            body: latestAnnouncement.body,
            publishedAt: latestAnnouncement.publishedAt!,
          }
        : null;

    return { release, announcement };
  }

  async markReleaseSeen(userId: number, releaseId: number): Promise<void> {
    const release = await this.prisma.releases.findUnique({
      where: { id: releaseId },
      select: { id: true, publishedAt: true },
    });
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { lastSeenReleaseAt: true, lastSeenReleaseId: true },
    });
    // An unpublished release is one no splash ever offered, so there is nothing
    // to record — and recording its id alone would corrupt the pair.
    if (!release?.publishedAt || !user) return;

    const next = this.advanceWatermark(
      { id: release.id, publishedAt: release.publishedAt },
      { seenAt: user.lastSeenReleaseAt, seenId: user.lastSeenReleaseId },
    );
    if (!next) return;

    await this.prisma.users.update({
      where: { id: userId },
      data: { lastSeenReleaseId: next.seenId, lastSeenReleaseAt: next.seenAt },
    });
  }

  async markAnnouncementSeen(userId: number, announcementId: number): Promise<void> {
    const announcement = await this.prisma.announcements.findUnique({
      where: { id: announcementId },
      select: { id: true, publishedAt: true, status: true },
    });
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { lastSeenAnnouncementAt: true, lastSeenAnnouncementId: true },
    });
    if (
      !announcement?.publishedAt ||
      announcement.status !== AnnouncementStatus.PUBLISHED ||
      !user
    ) {
      return;
    }

    const next = this.advanceWatermark(
      { id: announcement.id, publishedAt: announcement.publishedAt },
      { seenAt: user.lastSeenAnnouncementAt, seenId: user.lastSeenAnnouncementId },
    );
    if (!next) return;

    await this.prisma.users.update({
      where: { id: userId },
      data: { lastSeenAnnouncementId: next.seenId, lastSeenAnnouncementAt: next.seenAt },
    });
  }

  /**
   * The pair to write, or null for "the watermark already covers this".
   *
   * **The id and the date are written together or not at all.** The route takes
   * an id from the client, so it can name an older release than the one the
   * watermark already holds; recording that id while keeping the newer date
   * would leave a pair that never existed, and the tie branch of
   * `isAfterWatermark` would then read the genuinely-seen latest release as
   * unseen again -- the same defect in a new place.
   *
   * A watermark with no date yet is always written, so a row the backfill could
   * not reconstruct heals on the member's next dismissal.
   */
  private advanceWatermark(
    item: { id: number; publishedAt: Date },
    watermark: SeenWatermark,
  ): { seenId: number; seenAt: Date } | null {
    if (watermark.seenAt !== null && !isAfterWatermark(item, watermark)) return null;
    return { seenId: item.id, seenAt: item.publishedAt };
  }
}
