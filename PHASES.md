# DinnerBears — Development Phases

Update `CLAUDE.md` "Current Development Phase" when moving to a new phase.

---

## Phase 1 — Project Foundation & Design System

- Docker Compose scaffold (nginx, angular, nestjs-api, mysql)
- Angular 19 project init — standalone, routing, SCSS
- Angular Material custom theme (DinnerBears blue #1E4D8C)
- Responsive shell layout: MatToolbar nav, MatSidenav mobile, footer
- City selector dropdown in nav
- NGINX internal proxy: /api/* → nestjs-api container
- NestJS project init with TypeORM + MySQL connection
- Health check: GET /api/v1/health → 200 with database status
- VS Code workspace settings committed
- ESLint + Prettier configured and passing
- .env.example with all required keys documented
- Placeholder static site deployed at dinnerbears.com (landing, privacy, terms)

**Definition of done:** `docker compose up` → Angular shell at localhost,
/api/v1/health returns 200 with database: "connected", ESLint passes,
responsive at 375px + 1280px, dinnerbears.com live with placeholder site.

---

## Phase 2 — Google Auth & Invite System

- Google OAuth (Passport strategy, /api/auth/google redirect)
- Invite link system — all five types:
  - `member` — single-use, 48 hours, tied to specific invitee email
  - `admin` — multi-use, up to 30 days, revocable
  - `campaign_facebook` — multi-use, up to 30 days, tied to a configured
    Facebook group, admin-only creation
  - `guest_rsvp` — single-use, expires at event date (Phase 4)
  - `shareable_rsvp` — single-use, expires at event date (Phase 4)
- Invite lineage tracking (invited_by, invite_source on users table)
- Campaign link admin UI: select Facebook group, set expiry (1–30 days),
  set use cap or unlimited, generate and copy link
- Only one active pending invite per invitee email at a time
- Expired link handling: friendly message, no silent failures
- Basic member profile page (name, email, city, photo)
- Device fingerprinting (login_sessions + geoip-lite)
- Security alert in-app notification on new device login
- Admin Invites tab: generate, view, revoke, view lineage tree

**Definition of done:** Admin can log in with Google, generate all invite
types, post a campaign link to Facebook, and new members can register via
that link with correct lineage recorded. Single-use invites expire after
48 hours and are tied to the invitee's email.

---

## Phase 3 — Restaurant Database UI

- NestJS RestaurantsModule (CRUD, role-gated to admin/moderator)
- Geocoding integration (address → lat/lng on save)
- Photo upload (@nestjs/multer, stored to Unraid volume)
- Angular restaurant list (search by name, filter by city, MatCard layout)
- Restaurant detail page (photo carousel, description, map link, website)
- Admin/moderator create and edit forms
- Soft delete (is_active flag, not hard delete)

**Definition of done:** Admins and moderators can create, edit, and manage
restaurants. Members can browse and search. Photos upload and display.
Geocoded map links generate from addresses.

---

## Phase 3.5 — Historical Restaurant Import

- Facebook OAuth token setup (admin logs in with Facebook to generate token)
- One-time script: pull all past events from Group 1 via Facebook Graph API
- Export to .xlsx: Event Title, Date, Location Name, Address, Notes
- Admin reviews and cleans spreadsheet in Excel/Google Sheets
- Import script: read cleaned .xlsx → insert into restaurants table
- Geocoding runs automatically on each imported address
- Duplicate detection by name (case-insensitive); existing records skipped
- Admin reviews final data in HeidiSQL, edits or removes as needed

**Definition of done:** restaurants table populated from historical Facebook
events, all records geocoded, admin has reviewed and cleaned the data.

**Note:** Facebook OAuth token obtained here is stored and reused in
Phase 6 when Facebook login is added for members.

---

## Phase 4 — Events & RSVP System

- NestJS EventsModule (CRUD, restaurant snapshot on creation)
- Event states: draft → published → cancelled
- Event listing (city filter, upcoming/past toggle, MatCard layout)
- Member RSVP (add/remove, additional guests 0–9 dropdown)
- Guest RSVP form (name + email, no account required)
- Guest confirmation email with cancel link and optional invite offer
- Guest invite link generated on confirmation (30-day expiry)
- +1 options: name them, send by email, copy shareable link
- `guest_rsvp` and `shareable_rsvp` invite types activated
- RSVP display: members (count + names), guests (count only), additional
  guests count, Total Seats Needed prominently shown
- Admin event page: full breakdown with names, emails, who invited whom
- Share to Facebook button (admin only): opens FB composer pre-filled
- Copy Post Text button: copies formatted event text to clipboard
- Calendar export: .ics, Google Calendar URL, Apple Calendar deep link
- All guest links tied to inviting member for lineage tracking

**Definition of done:** Admin can publish events, members and guests can
RSVP, +1 links work, headcount displays correctly, Share to Facebook
generates correct pre-filled text, Total Seats Needed is accurate.

---

## Phase 5 — Email System

- Brevo SDK integration (EmailService)
- MySQL email queue (email_queue table)
- EmailDispatcherService cron (every 5 min, priority ordering)
- Gmail SMTP fallback (Nodemailer)
- email_provider_config toggle
- Brevo send-event webhooks: delivery, open, bounce, block, spam complaint
- email_status field lifecycle: pending → active → unsubscribed/bounced/complained
- email_suppressions table: hash-based post-deletion suppression
- Re-subscribe flow: Brevo suppression list API call + status reset
- Suppression check on new registration
- Unsubscribe banner on login for unsubscribed members
- Spam complaint banner with instructions (not self-service reversible)
- All 11 transactional email templates created and tested in Brevo
- Member notification preferences (notification_preferences table)
- Profile → Notifications tab with per-template opt-in/out toggles
- Admin email dashboard: send counts, overflow toggle, retry failed,
  bounce and complaint log
- Inactivity cron: 60-day re-engagement, 90-day final warning,
  120-day soft delete, 150-day hard delete

**Definition of done:** All 11 templates send via Brevo, Gmail fallback
activates on toggle, Brevo webhooks update delivery status, bounce/complaint/
unsubscribe flows work end-to-end, inactivity cron runs correctly, member
preferences respected, suppression survives hard delete and re-registration.

---

## Phase 6 — Facebook OAuth & Email/Password Auth

- Facebook OAuth (same Meta App as Phase 3.5 token)
- Account linking (oauth_accounts table, profile Security tab)
- Email + password registration (invite still required)
- Email verification flow (48-hour token, pending → active)
- Resend verification email
- Password reset flow (time-limited token, single-use)
- Password change from profile Security tab
- Account deletion request (soft delete, 30-day recovery)
- Hard delete job (runs nightly, processes accounts past 30-day window)

**Definition of done:** Members can log in via Google, Facebook, or
email/password. New email accounts require verification. Password reset
works. Account deletion soft-deletes with recovery window. Facebook OAuth
token from Phase 3.5 is reused correctly.

---

## Phase 7 — Push Notifications & Announcements

- Web Push: VAPID key pair, push_subscriptions table, PushService
- Angular PWA service worker upgrade (push event handler)
- iOS Add-to-Home-Screen onboarding banner
- NotificationBellComponent (badge, dropdown, mark-as-read)
- SSE or 60-second polling for real-time bell updates
- Announcements system (draft/publish, city-scoped, comments)
- Content flagging (content_flags table, moderation queue)
- Moderator in-app notification on new flag

**Definition of done:** Push notifications deliver on desktop and iOS PWA,
bell component shows unread count, announcements publish with comments,
flagged content appears in moderation queue.

---

## Phase 8 — Admin Panel, Audit Log & Security

- Full audit log viewer (filterable, read-only)
- Admin Users tab: all members, roles, suspend, delete, email status,
  inactivity segments, manual suppression override
- Admin Cities tab: configure Group 1 per city, Group 2 for Dayton,
  campaign link management
- Admin Invite tree: full lineage view for any member
- Community invite log (admin-only initially)
- Pre-launch OWASP Top 10 security checklist sign-off
- Rate limiting audit and hardening
- Final performance review and load testing

**Definition of done:** All admin tabs functional, audit log captures all
required actions, invite lineage fully visible, security checklist signed
off, system ready for real users.
