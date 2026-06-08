import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const moderatorGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  const role = auth.currentUser()?.role;
  if (role === 'admin' || role === 'moderator') return true;
  return router.createUrlTree(['/']);
};
