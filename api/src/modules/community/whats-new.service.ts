import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { ReleaseEntity } from '../../database/entities/release.entity';
import { AnnouncementEntity, AnnouncementStatus } from '../../database/entities/announcement.entity';

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
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(ReleaseEntity)
    private readonly releaseRepo: Repository<ReleaseEntity>,
    @InjectRepository(AnnouncementEntity)
    private readonly announcementRepo: Repository<AnnouncementEntity>,
  ) {}

  async getUnseen(userId: number): Promise<{ release: WhatsNewRelease | null; announcement: WhatsNewAnnouncement | null }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return { release: null, announcement: null };

    const latestRelease = await this.releaseRepo.findOne({
      where: { publishedAt: Not(IsNull()) },
      order: { publishedAt: 'DESC' },
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

    const latestAnnouncement = await this.announcementRepo.findOne({
      where: { status: AnnouncementStatus.PUBLISHED },
      order: { publishedAt: 'DESC' },
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
    await this.userRepo.update(userId, { lastSeenReleaseId: releaseId });
  }

  async markAnnouncementSeen(userId: number, announcementId: number): Promise<void> {
    await this.userRepo.update(userId, { lastSeenAnnouncementId: announcementId });
  }
}
