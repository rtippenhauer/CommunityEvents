import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BrandConfigService } from '../services/brand-config.service';

/**
 * Gate for screens that operate something **deployment-wide** rather than one
 * community — the release notes being the first.
 *
 * `adminGuard` alone was wrong for those: it asks what role somebody holds and
 * says nothing about which community they hold it in, so every community's
 * admin was offered the Releases screen and could navigate to it. The API
 * refused every call once `RootTenantGuard` landed, but a page that loads and
 * then fails on everything reads as a broken screen rather than as one that was
 * never meant to be there — which is exactly how Rob found it (2026-10-03).
 *
 * **The browser can check this**, contrary to what `systemAdminGuard`'s comment
 * says: `isRoot` rides in the branding payload, which is where
 * `rootLandingGuard` already reads it. That comment predates the payload
 * carrying it.
 *
 * Presentation only, like every client-side guard here. The server's
 * `RootTenantGuard` is the enforcement; this exists so the door is not painted
 * on a wall somebody cannot walk through.
 */
export const rootTenantGuard: CanActivateFn = () => {
  const brand = inject(BrandConfigService);
  const router = inject(Router);

  // Branding resolves in an app initializer, so this is safe to read
  // synchronously — the same reason rootLandingGuard can. The default is
  // `false`, so an unresolved payload sends somebody home rather than into a
  // screen that will 403.
  if (brand.isRoot()) return true;
  return router.createUrlTree(['/']);
};
