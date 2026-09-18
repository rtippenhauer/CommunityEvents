import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { routes } from './app.routes';
import { AuthService } from './core/services/auth.service';
import { BrandConfigService } from './core/services/brand-config.service';
import { LandingComponent } from './features/landing/landing.component';
import { HomeComponent } from './features/home/home.component';

/**
 * `/` is served by two different components (v2-13) and which one answers is
 * decided by `rootLandingGuard` at match time. The guard's own truth table is
 * covered in `core/guards/guards.spec.ts`; what is tested here is the wiring,
 * which is the part that is novel and therefore the part most likely to be
 * wrong — two route entries on one path, ordered, the first declining.
 *
 * Worth testing at this level rather than trusting the guard spec: a guard
 * that returns the right answer still renders the wrong page if the routes are
 * in the wrong order, if the second entry is unreachable, or if `canMatch` was
 * written as `canActivate` (which cancels the navigation instead of falling
 * through to the next route).
 */
describe('app routes — the two components that answer /', () => {
  function setup(isRoot: boolean, isLoggedIn: boolean) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: AuthService, useValue: { isLoggedIn: () => isLoggedIn } },
        {
          provide: BrandConfigService,
          useValue: {
            isRoot: () => isRoot,
            brand: signal({ name: 'CommunityEvents' }),
          },
        },
      ],
    });
    return TestBed.inject(Router);
  }

  // Compared by class identity rather than by `.name`: the bundler renames
  // classes (HomeComponent arrives as `_HomeComponent`), so a name comparison
  // passes or fails on the build tooling rather than on the routing.
  async function componentAtRoot(isRoot: boolean, isLoggedIn: boolean): Promise<unknown> {
    const router = setup(isRoot, isLoggedIn);
    await router.navigateByUrl('/');
    const matched = router.routerState.snapshot.root.firstChild?.routeConfig;
    return (matched as { loadComponent: () => Promise<unknown> }).loadComponent();
  }

  it('gives a signed-out visitor on the root tenant the landing page', async () => {
    expect(await componentAtRoot(true, false)).toBe(LandingComponent);
  });

  it('gives a signed-in member of the root tenant the member home page', async () => {
    expect(await componentAtRoot(true, true)).toBe(HomeComponent);
  });

  it('gives a community tenant the member home page', async () => {
    expect(await componentAtRoot(false, false)).toBe(HomeComponent);
  });
});
