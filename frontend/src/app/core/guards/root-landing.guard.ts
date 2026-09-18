import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { BrandConfigService } from '../services/brand-config.service';

/**
 * Decides whether `/` renders the public landing page instead of the member
 * home page (v2-13).
 *
 * Two conditions, and both matter:
 *
 * - **This is the root tenant.** The landing page is the platform's front
 *   door, not a community's. `isRoot` comes from the branding payload, which
 *   the API answers from the resolved tenant row — so the answer is the
 *   database's `is_root`, not a guess made from the host. Deciding this in
 *   nginx (a `server_name` for the marketing host) was the obvious
 *   alternative and is wrong for the same reason a stored flag was wrong in
 *   v2-12: it is a second answer to "which tenant is root", free to disagree
 *   with the column that actually decides it.
 * - **Nobody is signed in.** A member of the root community — on stage that
 *   is the operator's own test community, and everywhere it is at least the
 *   system admin — has a home page, and replacing it with marketing copy
 *   would be a regression for the only people who hold an account there.
 *   Marketing is for visitors.
 *
 * Safe to read both signals synchronously: `AuthService.init()` and
 * `BrandConfigService.init()` are both `provideAppInitializer` promises
 * (app.config.ts), so bootstrap blocks on them and no route is matched until
 * both have resolved. A `canMatch` that ran before branding loaded would read
 * the `isRoot: false` default, pick the member home page, and never be
 * re-evaluated.
 */
export const rootLandingGuard: CanMatchFn = () => {
  const brand = inject(BrandConfigService);
  const auth = inject(AuthService);
  return brand.isRoot() && !auth.isLoggedIn();
};
