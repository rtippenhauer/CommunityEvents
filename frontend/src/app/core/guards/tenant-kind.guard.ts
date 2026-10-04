import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BrandConfigService } from '../services/brand-config.service';

/**
 * Keeps the shared bug board away from demo communities (v2-32).
 *
 * `demo.service` makes every demo requester an **admin** of their demo, so
 * `adminGuard` alone would offer this screen to anybody who filled in the demo
 * form — and the board carries other communities' operational detail in free
 * text. The API's `NonDemoTenantGuard` is the enforcement; this exists so the
 * door is not painted on a wall they cannot walk through, which is exactly the
 * defect the Releases link had on 2026-10-03.
 *
 * Safe to read synchronously for the same reason `rootLandingGuard` is:
 * branding resolves in a `provideAppInitializer` promise, so no route is
 * matched until it has.
 */
export const nonDemoTenantGuard: CanActivateFn = () => {
  const brand = inject(BrandConfigService);
  const router = inject(Router);

  // `isDemo` defaults to false, so an unresolved payload lets the navigation
  // through and the API refuses it. That is the right way round here: the
  // failure is a 403 on a screen rather than a real community's admin being
  // bounced off a page they are entitled to.
  return brand.isDemo() ? router.createUrlTree(['/']) : true;
};

/**
 * The complement, for the demo's own feedback form.
 *
 * Allowed inside a demo, and also on the root tenant — where the same component
 * is the operator's list of what every demo visitor has said. Refused anywhere
 * else, because a real community has its own feedback board and nothing to say
 * about a demo.
 */
export const demoFeedbackGuard: CanActivateFn = () => {
  const brand = inject(BrandConfigService);
  const router = inject(Router);

  if (brand.isDemo() || brand.isRoot()) return true;
  return router.createUrlTree(['/']);
};
