import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { isSystemAdmin } from '../utils/roles.util';

/**
 * Gate for the tenant-management screens.
 *
 * Presentation only, and deliberately weaker than its server counterpart: the
 * API's SystemAdminGuard requires the role *and* that the request resolved to
 * the root tenant, which the browser has no way to check. Getting this wrong
 * therefore costs a 403 from the API, never data.
 *
 * Note it does not accept `admin` the way adminGuard now accepts `system_admin`.
 * The hierarchy runs one way on purpose: administering a community does not
 * make someone the operator of the deployment.
 */
export const systemAdminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (isSystemAdmin(auth.currentUser()?.role)) return true;
  return router.createUrlTree(['/']);
};
