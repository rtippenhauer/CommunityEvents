import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, firstValueFrom, of, tap } from 'rxjs';
import { Observable } from 'rxjs';

export interface CurrentUser {
  id: number;
  fullName: string;
  email: string;
  role: string;
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

  linkFacebook(accessToken: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>('/api/v1/auth/facebook/link', { accessToken });
  }

  logout(): void {
    this.http
      .post('/api/v1/auth/logout', {}, { withCredentials: true })
      .pipe(
        tap(() => {
          this.currentUser.set(null);
          this.router.navigate(['/login']);
        }),
        catchError(() => {
          this.currentUser.set(null);
          this.router.navigate(['/login']);
          return of(null);
        }),
      )
      .subscribe();
  }

  updatePhoto(path: string | null): void {
    this.currentUser.update(u => u ? { ...u, profilePhotoPath: path } : null);
  }

  isLoggedIn(): boolean {
    return this.currentUser() !== null;
  }
}
