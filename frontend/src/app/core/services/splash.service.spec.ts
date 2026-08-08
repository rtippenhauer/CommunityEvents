import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SplashService } from './splash.service';
import { CommunityService } from './community.service';

// The post-login splash queue. Worth real coverage because its rules are
// invisible when they misbehave: a de-duplication bug shows up as a member
// being shown the same achievement dialog over and over on a 60s poll.
describe('SplashService', () => {
  let service: SplashService;
  let community: jasmine.SpyObj<CommunityService>;

  const achievement = (memberAchievementId: number) =>
    ({ memberAchievementId, name: `A${memberAchievementId}` }) as never;

  function setup(options: {
    achievements?: unknown[];
    release?: unknown;
    announcement?: unknown;
    failAchievements?: boolean;
  } = {}) {
    community = jasmine.createSpyObj<CommunityService>('CommunityService', [
      'getUnseenAchievements',
      'getWhatsNew',
      'markAchievementSeen',
      'markReleaseSeen',
      'markAnnouncementSeen',
    ]);

    community.getUnseenAchievements.and.returnValue(
      (options.failAchievements
        ? throwError(() => new Error('boom'))
        : of(options.achievements ?? [])) as never,
    );
    community.getWhatsNew.and.returnValue(
      of({
        release: options.release ?? null,
        announcement: options.announcement ?? null,
      }) as never,
    );
    community.markAchievementSeen.and.returnValue(of(undefined) as never);
    community.markReleaseSeen.and.returnValue(of(undefined) as never);
    community.markAnnouncementSeen.and.returnValue(of(undefined) as never);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [SplashService, { provide: CommunityService, useValue: community }],
    });
    service = TestBed.inject(SplashService);
  }

  describe('checkNow', () => {
    it('starts with an empty queue', () => {
      setup();
      expect(service.queue()).toEqual([]);
    });

    it('queues every unseen achievement — these are uncapped', () => {
      setup({ achievements: [achievement(1), achievement(2), achievement(3)] });
      service.checkNow();
      expect(service.queue().length).toBe(3);
      expect(service.queue().every((i) => i.kind === 'achievement')).toBe(true);
    });

    it('queues at most one release and one announcement', () => {
      setup({ release: { id: 10 }, announcement: { id: 20 } });
      service.checkNow();

      const kinds = service.queue().map((i) => i.kind);
      expect(kinds.filter((k) => k === 'release').length).toBe(1);
      expect(kinds.filter((k) => k === 'announcement').length).toBe(1);
    });

    it('omits release and announcement entries when there are none', () => {
      setup({ achievements: [achievement(1)] });
      service.checkNow();
      expect(service.queue().length).toBe(1);
    });

    // The poll runs every 60s. Without de-duplication by queueKey, a member
    // would accumulate the same dialog repeatedly for as long as they stay
    // signed in.
    it('does not re-queue items it already holds when polled again', () => {
      setup({ achievements: [achievement(1)], release: { id: 10 } });

      service.checkNow();
      const first = service.queue().length;
      service.checkNow();
      service.checkNow();

      expect(service.queue().length).toBe(first);
    });

    // A failing endpoint must not take the whole splash down — the other
    // source should still populate.
    it("still queues what's new when the achievements call fails", () => {
      setup({ failAchievements: true, release: { id: 10 } });
      service.checkNow();
      expect(service.queue().length).toBe(1);
      expect(service.queue()[0].kind).toBe('release');
    });
  });

  describe('dismiss', () => {
    it('marks an achievement seen and drops it from the queue', () => {
      setup({ achievements: [achievement(1), achievement(2)] });
      service.checkNow();

      service.dismiss(service.queue()[0]);

      expect(community.markAchievementSeen).toHaveBeenCalledWith(1);
      expect(service.queue().length).toBe(1);
      expect(service.queue()[0].queueKey).toBe('achievement-2');
    });

    it('marks a release seen via the release endpoint, not the achievement one', () => {
      setup({ release: { id: 10 } });
      service.checkNow();

      service.dismiss(service.queue()[0]);

      expect(community.markReleaseSeen).toHaveBeenCalledWith(10);
      expect(community.markAchievementSeen).not.toHaveBeenCalled();
      expect(service.queue()).toEqual([]);
    });

    it('marks an announcement seen via its own endpoint', () => {
      setup({ announcement: { id: 20 } });
      service.checkNow();

      service.dismiss(service.queue()[0]);

      expect(community.markAnnouncementSeen).toHaveBeenCalledWith(20);
      expect(service.queue()).toEqual([]);
    });
  });

  describe('stopPolling', () => {
    // Called on logout — a queued dialog must not survive into the next
    // session, or the next person to sign in sees someone else's splash.
    it('empties the queue', () => {
      setup({ achievements: [achievement(1)] });
      service.checkNow();
      expect(service.queue().length).toBe(1);

      service.stopPolling();
      expect(service.queue()).toEqual([]);
    });
  });
});
