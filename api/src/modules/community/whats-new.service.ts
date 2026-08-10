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

// Post-login "what's new" splash — releases/announcements side of it
// (achievements have their own seen-tracking in AchievementsService). Each
// user carries a pointer (users.last_seen_release_id/last_seen_announcement_id)
// to the latest one they've been shown, so there's never a backlog — only
// the single latest unseen release and/or announcement, one of each at most.
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
      orderBy: { publishedAt: 'desc' },
    });
    const release =
      latestRelease && latestRelease.id !== user.lastSeenReleaseId
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
      orderBy: { publishedAt: 'desc' },
    });
    const announcement =
      latestAnnouncement && latestAnnouncement.id !== user.lastSeenAnnouncementId
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
    await this.prisma.users.update({
      where: { id: userId },
      data: { lastSeenReleaseId: releaseId },
    });
  }

  async markAnnouncementSeen(userId: number, announcementId: number): Promise<void> {
    await this.prisma.users.update({
      where: { id: userId },
      data: { lastSeenAnnouncementId: announcementId },
    });
  }
}
