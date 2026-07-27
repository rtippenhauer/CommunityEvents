import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { BrandConfigService, BrandFeatures } from '../services/brand-config.service';

// Blocks direct navigation to a per-instance feature that's been turned off,
// sending the user to the "not available" page. Branding (and thus the feature
// flags) is loaded via provideAppInitializer before any route activates, so the
// signal is populated here; a failed branding fetch leaves every flag true, so
// this never hides a feature that's actually enabled. Server @RequireFeature is
// the real enforcement — this is just UX so a stale link isn't a dead page.
export function featureGuard(feature: keyof BrandFeatures): CanActivateFn {
  return () => {
    const brand = inject(BrandConfigService);
    const router = inject(Router);
    return brand.features()[feature]
      ? true
      : router.createUrlTree(['/feature-unavailable']);
  };
}
