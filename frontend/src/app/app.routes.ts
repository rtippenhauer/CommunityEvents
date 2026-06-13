import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { adminGuard } from './core/guards/admin.guard';
import { moderatorGuard } from './core/guards/moderator.guard';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./features/home/home.component').then((m) => m.HomeComponent),
  },
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
    path: 'auth/error',
    loadComponent: () =>
      import('./features/auth/error/auth-error.component').then((m) => m.AuthErrorComponent),
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
    path: 'calendar',
    loadComponent: () =>
      import('./features/calendar/calendar.component').then((m) => m.CalendarComponent),
  },
  {
    path: 'rsvp-guest',
    loadComponent: () =>
      import('./features/events/guest-rsvp/guest-rsvp.component').then(
        (m) => m.GuestRsvpComponent,
      ),
  },
  {
    path: 'events',
    loadComponent: () =>
      import('./features/events/list/events-list.component').then(
        (m) => m.EventsListComponent,
      ),
  },
  {
    path: 'events/:id',
    loadComponent: () =>
      import('./features/events/detail/event-detail.component').then(
        (m) => m.EventDetailComponent,
      ),
  },
  {
    path: 'members',
    loadComponent: () =>
      import('./features/members/members.component').then((m) => m.MembersComponent),
    canActivate: [authGuard],
  },
  {
    path: 'members/:id',
    loadComponent: () =>
      import('./features/members/member-profile.component').then((m) => m.MemberProfileComponent),
    canActivate: [authGuard],
  },
  {
    path: 'invite',
    loadComponent: () =>
      import('./features/invite/invite.component').then((m) => m.InviteComponent),
    canActivate: [authGuard],
  },
  {
    path: 'join/:code',
    loadComponent: () =>
      import('./features/join/join.component').then((m) => m.JoinComponent),
  },
  // Feedback board
  {
    path: 'feedback',
    loadComponent: () =>
      import('./features/feedback/feedback-board.component').then((m) => m.FeedbackBoardComponent),
    canActivate: [authGuard],
  },
  {
    path: 'feedback/new',
    loadComponent: () =>
      import('./features/feedback/feedback-new.component').then((m) => m.FeedbackNewComponent),
    canActivate: [authGuard],
  },
  {
    path: 'feedback/:id',
    loadComponent: () =>
      import('./features/feedback/feedback-detail.component').then((m) => m.FeedbackDetailComponent),
    canActivate: [authGuard],
  },
  // Facebook data deletion status — no auth required
  {
    path: 'facebook-data-deletion',
    loadComponent: () =>
      import('./features/facebook-deletion/facebook-deletion.component').then(
        (m) => m.FacebookDeletionComponent,
      ),
  },
  // Announcements — public read, no auth required
  {
    path: 'announcements',
    loadComponent: () =>
      import('./features/announcements/announcements-list.component').then(
        (m) => m.AnnouncementsListComponent,
      ),
  },
  {
    path: 'announcements/:id',
    loadComponent: () =>
      import('./features/announcements/announcement-detail.component').then(
        (m) => m.AnnouncementDetailComponent,
      ),
  },
  // Public changelog — no auth required
  {
    path: 'updates',
    loadComponent: () =>
      import('./features/updates/updates.component').then((m) => m.UpdatesComponent),
  },
  // Admin
  {
    path: 'admin/invites',
    loadComponent: () =>
      import('./features/admin/invites/admin-invites.component').then(
        (m) => m.AdminInvitesComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/users',
    loadComponent: () =>
      import('./features/admin/users/admin-users.component').then(
        (m) => m.AdminUsersComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/email',
    loadComponent: () =>
      import('./features/admin/email/admin-email.component').then(
        (m) => m.AdminEmailComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/feedback',
    loadComponent: () =>
      import('./features/admin/feedback/admin-feedback.component').then(
        (m) => m.AdminFeedbackComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/releases/new',
    loadComponent: () =>
      import('./features/admin/releases/admin-releases.component').then(
        (m) => m.AdminReleasesComponent,
      ),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'admin/announcements',
    loadComponent: () =>
      import('./features/admin/announcements/admin-announcements.component').then(
        (m) => m.AdminAnnouncementsComponent,
      ),
    canActivate: [authGuard, moderatorGuard],
  },
  {
    path: 'admin/moderation',
    loadComponent: () =>
      import('./features/admin/moderation/admin-moderation.component').then(
        (m) => m.AdminModerationComponent,
      ),
    canActivate: [authGuard, moderatorGuard],
  },
  {
    path: '**',
    loadComponent: () =>
      import('./features/not-found/not-found.component').then((m) => m.NotFoundComponent),
  },
];
