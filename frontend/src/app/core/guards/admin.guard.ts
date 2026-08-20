import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { hasAdminRights } from '../../core/utils/roles.util';

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const user = auth.currentUser();
  if (hasAdminRights(user?.role)) return true;
  return router.createUrlTree(['/']);
};
