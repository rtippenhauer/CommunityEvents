import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(req.clone({ withCredentials: true })).pipe(
    catchError((err) => {
      // On 401, clear auth state and redirect — skip the init call since AuthService.init() handles that itself
      if (err instanceof HttpErrorResponse && err.status === 401 && !req.url.includes('/auth/me')) {
        auth.currentUser.set(null);
        void router.navigate(['/login']);
      }
      return throwError(() => err);
    }),
  );
};
