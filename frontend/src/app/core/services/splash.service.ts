import { Injectable, inject, signal } from '@angular/core';
import { CommunityService, UnseenAchievement, WhatsNewRelease, WhatsNewAnnouncement } from './community.service';

export type SplashItem =
  | { kind: 'achievement'; queueKey: string; achievement: UnseenAchievement }
  | { kind: 'release'; queueKey: string; release: WhatsNewRelease }
  | { kind: 'announcement'; queueKey: string; announcement: WhatsNewAnnouncement };

// Post-login "what's new" splash queue — achievements (uncapped, one dialog
// per unseen achievement) plus at most one latest-unseen release and one
// latest-unseen announcement, all shown through the same dialog/queue.
@Injectable({ providedIn: 'root' })
export class SplashService {
  private readonly communityService = inject(CommunityService);

  readonly queue = signal<SplashItem[]>([]);

  private pollInterval: ReturnType<typeof setInterval> | null = null;

  startPolling(): void {
    if (this.pollInterval) return;
    this.checkNow();
    this.pollInterval = setInterval(() => this.checkNow(), 60_000);
  }

  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.queue.set([]);
  }

  checkNow(): void {
    this.communityService.getUnseenAchievements().subscribe({
      next: (list) => this.enqueue(
        list.map((a) => ({
          kind: 'achievement' as const,
          queueKey: `achievement-${a.memberAchievementId}`,
          achievement: a,
        })),
      ),
      error: () => {},
    });

    this.communityService.getWhatsNew().subscribe({
      next: ({ release, announcement }) => {
        const items: SplashItem[] = [];
        if (release) items.push({ kind: 'release', queueKey: `release-${release.id}`, release });
        if (announcement) items.push({ kind: 'announcement', queueKey: `announcement-${announcement.id}`, announcement });
        this.enqueue(items);
      },
      error: () => {},
    });
  }

  private enqueue(items: SplashItem[]): void {
    if (items.length === 0) return;
    this.queue.update((q) => {
      const existingKeys = new Set(q.map((x) => x.queueKey));
      const additions = items.filter((i) => !existingKeys.has(i.queueKey));
      return [...q, ...additions];
    });
  }

  dismiss(item: SplashItem): void {
    switch (item.kind) {
      case 'achievement':
        this.communityService.markAchievementSeen(item.achievement.memberAchievementId).subscribe({ error: () => {} });
        break;
      case 'release':
        this.communityService.markReleaseSeen(item.release.id).subscribe({ error: () => {} });
        break;
      case 'announcement':
        this.communityService.markAnnouncementSeen(item.announcement.id).subscribe({ error: () => {} });
        break;
    }
    this.queue.update((q) => q.filter((x) => x.queueKey !== item.queueKey));
  }
}
