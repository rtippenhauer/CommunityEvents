import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { TenantStatusService } from '../services/tenant-status.service';

/**
 * Notices when the API says this host has no tenant (REQ-TENANT-01.2) so the
 * app can show the "not set up" page instead of a half-broken shell.
 *
 * An interceptor rather than a check inside BrandConfigService.init(): on an
 * unrecognized host *every* call fails the same way, including the ones that
 * fire before branding and the ones a later navigation makes, and each of them
 * already swallows its own errors. One place that watches all of them cannot
 * be forgotten by the next service that starts calling the API at startup.
 *
 * The error is always re-thrown — this only observes.
 */
export const tenantInterceptor: HttpInterceptorFn = (req, next) => {
  const tenantStatus = inject(TenantStatusService);

  return next(req).pipe(
    catchError((err) => {
      if (err instanceof HttpErrorResponse) tenantStatus.record(err.error);
      return throwError(() => err);
    }),
  );
};
