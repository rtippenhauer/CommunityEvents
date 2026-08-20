import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { isElevatedRole } from '../../core/utils/roles.util';

export const moderatorGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const role = auth.currentUser()?.role;
  if (isElevatedRole(role)) return true;
  return router.createUrlTree(['/']);
};
