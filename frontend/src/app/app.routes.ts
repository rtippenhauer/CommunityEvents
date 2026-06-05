import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./features/auth/callback/callback.component').then((m) => m.CallbackComponent),
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('./features/profile/profile.component').then((m) => m.ProfileComponent),
    canActivate: [authGuard],
  },
  {
    path: 'restaurants',
    loadComponent: () =>
      import('./features/restaurants/list/restaurants-list.component').then(
        (m) => m.RestaurantsListComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: 'restaurants/:id',
    loadComponent: () =>
      import('./features/restaurants/detail/restaurant-detail.component').then(
        (m) => m.RestaurantDetailComponent,
      ),
    canActivate: [authGuard],
  },
  {
    path: 'admin/invites',
    loadComponent: () =>
      import('./features/admin/invites/admin-invites.component').then(
        (m) => m.AdminInvitesComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  { path: '', pathMatch: 'full', redirectTo: 'login' },
];
