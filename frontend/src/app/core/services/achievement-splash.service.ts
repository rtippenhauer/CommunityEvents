import { Injectable, inject, signal } from '@angular/core';
import { CommunityService, UnseenAchievement } from './community.service';

@Injectable({ providedIn: 'root' })
export class AchievementSplashService {
  private readonly communityService = inject(CommunityService);

  readonly queue = signal<UnseenAchievement[]>([]);

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
      next: (list) => {
        if (list.length === 0) return;
        this.queue.update((q) => {
          const existingIds = new Set(q.map((x) => x.memberAchievementId));
          const additions = list.filter((l) => !existingIds.has(l.memberAchievementId));
          return [...q, ...additions];
        });
      },
      error: () => {},
    });
  }

  dismiss(memberAchievementId: number): void {
    this.communityService.markAchievementSeen(memberAchievementId).subscribe({ error: () => {} });
    this.queue.update((q) => q.filter((x) => x.memberAchievementId !== memberAchievementId));
  }
}
