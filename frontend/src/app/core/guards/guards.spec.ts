import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { validatedMemberGuard } from './validated-member.guard';
import { featureGuard } from './feature.guard';
import { adminGuard } from './admin.guard';
import { moderatorGuard } from './moderator.guard';
import { unsavedChangesGuard, HasUnsavedChanges } from './unsaved-changes.guard';
import { AuthService } from '../services/auth.service';
import { BrandConfigService } from '../services/brand-config.service';

// Functional CanActivateFn guards. They are pure enough to call directly inside
// a TestBed injection context, which avoids standing up real routing.
//
// Worth stating plainly: none of these guards are security. The API enforces
// roles and feature flags. These only stop a stale link landing on a dead page,
// so what matters is that the *redirect targets* are right.
describe('route guards', () => {
  function runGuard(guard: () => boolean | UrlTree): boolean | UrlTree {
    return TestBed.runInInjectionContext(guard);
  }

  describe('authGuard', () => {
    function setup(isLoggedIn: boolean) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: AuthService, useValue: { isLoggedIn: () => isLoggedIn } },
        ],
      });
    }

    it('allows a logged-in user through', () => {
      setup(true);
      expect(runGuard(authGuard as () => boolean | UrlTree)).toBe(true);
    });

    it('redirects an anonymous visitor to /login', () => {
      setup(false);
      const result = runGuard(authGuard as () => boolean | UrlTree);
      expect(result).toEqual(TestBed.inject(Router).createUrlTree(['/login']));
    });
  });

  describe('validatedMemberGuard', () => {
    function setup(isLoggedIn: boolean, isNonValidated: boolean) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          {
            provide: AuthService,
            useValue: { isLoggedIn: () => isLoggedIn, isNonValidated: () => isNonValidated },
          },
        ],
      });
    }

    it('allows a fully validated member through', () => {
      setup(true, false);
      expect(runGuard(validatedMemberGuard as () => boolean | UrlTree)).toBe(true);
    });

    // A non-validated member is logged in, so bouncing them to /login would be
    // both wrong and confusing — they go to /events, which they can use.
    it('sends a non-validated member to /events, not /login', () => {
      setup(true, true);
      const result = runGuard(validatedMemberGuard as () => boolean | UrlTree);
      expect(result).toEqual(TestBed.inject(Router).createUrlTree(['/events']));
    });

    it('sends an anonymous visitor to /login', () => {
      setup(false, false);
      const result = runGuard(validatedMemberGuard as () => boolean | UrlTree);
      expect(result).toEqual(TestBed.inject(Router).createUrlTree(['/login']));
    });
  });

  describe('featureGuard', () => {
    function setup(features: Record<string, boolean>) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          { provide: BrandConfigService, useValue: { features: () => features } },
        ],
      });
    }

    it('allows navigation when the feature is enabled', () => {
      setup({ ratings: true });
      expect(runGuard(featureGuard('ratings') as () => boolean | UrlTree)).toBe(true);
    });

    it('redirects to /feature-unavailable when the feature is off', () => {
      setup({ merch: false });
      const result = runGuard(featureGuard('merch') as () => boolean | UrlTree);
      expect(result).toEqual(TestBed.inject(Router).createUrlTree(['/feature-unavailable']));
    });

    it('gates each feature independently', () => {
      setup({ ratings: true, leaderboard: false });
      expect(runGuard(featureGuard('ratings') as () => boolean | UrlTree)).toBe(true);
      expect(runGuard(featureGuard('leaderboard') as () => boolean | UrlTree)).not.toBe(true);
    });
  });
  describe('adminGuard', () => {
    function setup(role: string | null) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          {
            provide: AuthService,
            useValue: { currentUser: () => (role === null ? null : { role }) },
          },
        ],
      });
    }

    it('allows an admin through', () => {
      setup('admin');
      expect(runGuard(adminGuard as () => boolean | UrlTree)).toBe(true);
    });

    // A moderator is privileged but NOT an admin — this guard is the narrower
    // of the two and must not widen to accept them.
    it('turns away a moderator, a member and an anonymous visitor', () => {
      const home = () => TestBed.inject(Router).createUrlTree(['/']);

      for (const role of ['moderator', 'member', null]) {
        setup(role);
        expect(runGuard(adminGuard as () => boolean | UrlTree), `role=${role}`)
          .toEqual(home());
      }
    });
  });

  describe('moderatorGuard', () => {
    function setup(role: string | null) {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([]),
          {
            provide: AuthService,
            useValue: { currentUser: () => (role === null ? null : { role }) },
          },
        ],
      });
    }

    // Deliberately wider than adminGuard: admin satisfies it too, so an admin
    // is never locked out of moderator tooling.
    it('allows both moderator and admin through', () => {
      for (const role of ['moderator', 'admin']) {
        setup(role);
        expect(runGuard(moderatorGuard as () => boolean | UrlTree), `role=${role}`)
          .toBe(true);
      }
    });

    it('turns away a plain member and an anonymous visitor', () => {
      const home = () => TestBed.inject(Router).createUrlTree(['/']);

      for (const role of ['member', 'non_validated', null]) {
        setup(role);
        expect(runGuard(moderatorGuard as () => boolean | UrlTree), `role=${role}`)
          .toEqual(home());
      }
    });
  });

  // CanDeactivateFn, so it takes the component rather than being called bare.
  describe('unsavedChangesGuard', () => {
    function run(dirty: boolean): boolean {
      const component: HasUnsavedChanges = { hasUnsavedChanges: () => dirty };
      return unsavedChangesGuard(
        component,
        null!,
        null!,
        null!,
      ) as boolean;
    }

    it('leaves immediately when there is nothing unsaved, without prompting', () => {
      const confirmSpy = vi.spyOn(window, 'confirm');
      expect(run(false)).toBe(true);
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it('blocks navigation when the member cancels the prompt', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      expect(run(true)).toBe(false);
    });

    it('allows navigation when the member confirms', () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      expect(run(true)).toBe(true);
    });
  });
});
