# DinnerBears — Development Phases

Update `CLAUDE.md` "Current Development Phase" when moving to a new phase.

## Phase 1 — Project Foundation & Design System
**Status: CURRENT**
- Docker Compose scaffold (nginx, angular, nestjs-api, mysql)
- Angular 19 project init — standalone, routing, SCSS
- Angular Material custom theme (DinnerBears blue #1E4D8C)
- Responsive shell layout: MatToolbar nav, MatSidenav mobile, footer
- City selector dropdown in nav
- NGINX internal proxy: /api/* → nestjs-api container
- NestJS project init with TypeORM + MySQL connection
- Health check: GET /api/health → 200
- VS Code workspace settings committed
- ESLint + Prettier configured and passing
- .env.example with all required keys documented

**Definition of done:** `docker compose up` → Angular shell at localhost,
/api/health returns 200, ESLint passes, responsive at 375px + 1280px.

---

## Phase 2 — User Registration & Authentication
- Invite link system (InviteService, 3 types, token validation)
- Registration form (Reactive Forms + Material): name, email, password, city
- NestJS Passport JWT strategy, login endpoint, session tokens
- Angular AuthInterceptor + functional AuthGuard
- Member profile page: view/edit all fields, photo upload
- Password change form
- Password reset flow (Brevo Priority 1 email + token validation)
- @nestjs/throttler rate limiting on login + registration

---

## Phase 3 — Social Login & Account Security
- Google OAuth (Passport strategy, /api/auth/google redirect)
- Facebook OAuth (same Meta App as event posting)
- Account linking (oauth_accounts table, profile Security tab)
- Device fingerprinting (login_sessions + geoip-lite)
- Security alert emails + in-app notifications
- Account deletion request flow (soft delete)

---

## Phase 4 — Email System
- Brevo SDK integration (EmailService)
- MySQL email queue (email_queue table)
- EmailDispatcherService cron (every 5 min, priority ordering)
- Gmail SMTP fallback (Nodemailer)
- email_provider_config toggle
- All 9 Brevo templates created and tested
- Member notification preferences (notification_preferences table)
- Profile → Notifications tab with MatSlideToggle controls

---

## Phase 5 — Restaurant Database
- NestJS RestaurantsModule (CRUD, role-gated)
- Geocoding integration (address → lat/lng → Google Maps link)
- Photo upload (@nestjs/multer, stored to Unraid volume)
- Angular restaurant list (search, city filter, MatCard layout)
- Restaurant detail page (photo, description, map, website link)

---

## Phase 6 — Event System
- NestJS EventsModule (CRUD, restaurant pre-fill snapshot)
- Angular CityService (reads subdomain from window.location)
- RSVP system (add/remove, count display, confirmation notification)
- Calendar export (.ics RFC 5545, Google Calendar URL, Apple deep link)
- Standard description config table + per-event additional info
- Event listing (MatCard, city filter, upcoming/past toggle)

---

## Phase 7 — Facebook Integration & Notifications
- Facebook Graph API event posting (auto/manual, post status tracking)
- Web Push: VAPID key pair, push_subscriptions table, PushService
- Angular PWA service worker upgrade (push event handler)
- iOS Add-to-Home-Screen onboarding banner
- NotificationBellComponent (badge, dropdown, mark-as-read)
- SSE or 60-second polling for real-time bell updates
- Content flagging (content_flags table, moderation queue notifications)

---

## Phase 8 — News, Audit & Admin Panel
- AnnouncementsModule (draft/publish, city-scope, comments)
- Full audit log viewer (filterable, read-only)
- Admin panel (MatTabGroup): Users, Invites, Restaurants, Events,
  Announcements, Email Queue, Notifications, Cities, Audit Log, Config
- User management (roles, suspend, deletion reactivation)
- Invite management (generate, view, revoke)
- City config (add city, Facebook group, auto-post toggle)
- Email dashboard (Brevo/Gmail counts, overflow toggle, failed retry)
- Pre-launch security checklist sign-off
