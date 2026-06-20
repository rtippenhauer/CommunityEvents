import { Component, inject, computed, effect } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';
import { environment } from '../environments/environment';
import { AuthService } from './core/services/auth.service';
import { CityService, CitySlug } from './core/services/city.service';
import { FeedbackService } from './core/services/feedback.service';
import { NotificationBellComponent } from './shared/components/notification-bell/notification-bell.component';
import { IosInstallBannerComponent } from './shared/components/ios-install-banner/ios-install-banner.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatSidenavModule,
    MatIconModule,
    MatButtonModule,
    MatListModule,
    MatMenuModule,
    MatDividerModule,
    NotificationBellComponent,
    IosInstallBannerComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  private readonly breakpointObserver = inject(BreakpointObserver);
  readonly authService = inject(AuthService);
  readonly cityService = inject(CityService);
  readonly feedbackService = inject(FeedbackService);

  readonly currentYear = new Date().getFullYear();
  readonly isStage = environment.isStage;

  isMobile = toSignal(
    this.breakpointObserver
      .observe([Breakpoints.XSmall, Breakpoints.Small])
      .pipe(map((result) => result.matches)),
    { initialValue: false },
  );

  readonly userInitials = computed<string>(() => {
    const name = this.authService.currentUser()?.fullName ?? '';
    return name
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  });

  readonly userPhoto = computed<string | null>(
    () => this.authService.currentUser()?.profilePhotoPath ?? null,
  );

  readonly isAdmin = computed<boolean>(
    () => this.authService.currentUser()?.role === 'admin',
  );

  readonly isModerator = computed<boolean>(
    () => this.authService.currentUser()?.role === 'moderator',
  );

  readonly isNonValidated = computed<boolean>(
    () => this.authService.currentUser()?.role === 'non_validated',
  );

  constructor() {
    effect(() => {
      if (this.isAdmin()) {
        this.feedbackService.loadUnseenCount();
      } else {
        this.feedbackService.unseenCount.set(0);
      }
    });

    const swUpdate = inject(SwUpdate);
    if (swUpdate.isEnabled) {
      swUpdate.versionUpdates.pipe(
        filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'),
      ).subscribe(() => {
        swUpdate.activateUpdate().then(() => document.location.reload());
      });
      swUpdate.checkForUpdate();
    }
  }

  isLoggedIn(): boolean {
    return this.authService.isLoggedIn();
  }

  logout(): void {
    this.authService.logout();
  }

  selectCity(slug: CitySlug): void {
    this.cityService.select(slug);
  }
}
