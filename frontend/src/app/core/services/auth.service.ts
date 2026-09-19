import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, firstValueFrom, of, switchMap, tap } from 'rxjs';
import { Observable } from 'rxjs';

export interface CurrentUser {
  id: number;
  fullName: string;
  email: string;
  role: string;
  status: string;
  cityId: number;
  profilePhotoPath: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  readonly currentUser = signal<CurrentUser | null>(null);
  readonly isLoading = signal(true);

  init(): Promise<void> {
    return firstValueFrom(
      this.http.get<CurrentUser>('/api/v1/auth/me').pipe(
        tap((user) => this.currentUser.set(user)),
        catchError(() => {
          this.currentUser.set(null);
          return of(null);
        }),
      ),
    )
      .then(() => this.isLoading.set(false))
      .catch(() => this.isLoading.set(false));
  }

  loginWithGoogle(inviteToken?: string): void {
    const params = inviteToken ? `?inviteToken=${encodeURIComponent(inviteToken)}` : '';
    window.location.href = `/api/v1/auth/google${params}`;
  }

  loginWithFacebook(accessToken: string, inviteToken?: string): Observable<void> {
    return this.http.post<void>('/api/v1/auth/facebook', { accessToken, inviteToken }).pipe(
      tap(() => {
        // Re-fetch user then redirect, same as Google callback
        void firstValueFrom(
          this.http.get<CurrentUser>('/api/v1/auth/me').pipe(
            tap((user) => {
              this.currentUser.set(user);
              void this.router.navigate(['/']);
            }),
            catchError(() => of(null)),
          ),
        );
      }),
    );
  }

  /**
   * Exchanges the single-use ticket an OAuth callback handed us for a session
   * cookie on *this* host (REQ-TENANT-01.8).
   *
   * A POST rather than something the redirect could do by itself, and that is
   * what lets the session cookie stay `SameSite=strict`: the cross-site hop is
   * the navigation before this one, which carries no cookie because none exists
   * yet. This request is same-site, so the cookie it sets is stored and sent
   * normally from then on.
   */
  redeemHandoff(token: string): Observable<CurrentUser | null> {
    return this.http.post<{ message: string }>('/api/v1/auth/handoff', { token }).pipe(
      // The cookie exists only once the POST returns, so who we are is a
      // separate question that can only be asked afterwards.
      switchMap(() =>
        this.http.get<CurrentUser>('/api/v1/auth/me').pipe(
          tap((user) => this.currentUser.set(user)),
        ),
      ),
    );
  }

  linkFacebook(accessToken: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/v1/auth/facebook/link', { accessToken });
  }

  /**
   * `returnTo` exists for the invite flow, which has to come back to
   * `/login?token=…` rather than the bare login page — the token is the whole
   * point of the round trip and a plain `/login` drops it.
   */
  logout(returnTo?: { path: string; queryParams?: Record<string, string> }): void {
    const destination = returnTo ?? { path: '/login' };
    const land = () => {
      this.currentUser.set(null);
      void this.router.navigate([destination.path], { queryParams: destination.queryParams });
    };
    this.http
      .post('/api/v1/auth/logout', {}, { withCredentials: true })
      .pipe(
        tap(land),
        catchError(() => {
          land();
          return of(null);
        }),
      )
      .subscribe();
  }

  registerWithPassword(inviteToken: string, fullName: string, email: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/v1/auth/register', { inviteToken, fullName, email, password });
  }

  loginWithPassword(email: string, password: string): Observable<{ previousLastLoginAt: string | null; failedAttemptsSinceLastLogin?: number }> {
    return this.http.post<{ message: string; previousLastLoginAt: string | null; failedAttemptsSinceLastLogin?: number }>('/api/v1/auth/login', { email, password }).pipe(
      tap(() => {
        void firstValueFrom(
          this.http.get<CurrentUser>('/api/v1/auth/me').pipe(
            tap((user) => {
              this.currentUser.set(user);
              void this.router.navigate(['/']);
            }),
            catchError(() => of(null)),
          ),
        );
      }),
    );
  }

  forgotPassword(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/v1/auth/forgot-password', { email });
  }

  resetPassword(token: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/v1/auth/reset-password', { token, password });
  }

  verifyEmail(token: string): Observable<{ message: string }> {
    return this.http.get<{ message: string }>(`/api/v1/auth/verify-email?token=${encodeURIComponent(token)}`);
  }

  resendVerification(email: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/v1/auth/resend-verification', { email });
  }

  setPassword(email: string, password: string): Observable<{ message: string; needsVerification: boolean }> {
    return this.http.post<{ message: string; needsVerification: boolean }>('/api/v1/auth/set-password', { email, password });
  }

  changePassword(currentPassword: string, newPassword: string): Observable<{ message: string }> {
    return this.http.patch<{ message: string }>('/api/v1/auth/password', { currentPassword, newPassword });
  }

  updatePhoto(path: string | null): void {
    this.currentUser.update(u => u ? { ...u, profilePhotoPath: path } : null);
  }

  isLoggedIn(): boolean {
    return this.currentUser() !== null;
  }

  isNonValidated(): boolean {
    return this.currentUser()?.role === 'non_validated';
  }
}
