# DinnerBears — Product Requirements

_Last updated: 2026-05-31_

Requirements are numbered R-001 … R-NNN and grouped by domain. Each item is a
testable statement of what the system must do. Implementation details live in
CLAUDE.md, PHASES.md, and the module-level CLAUDE.md files.

---

## 1. Platform & Infrastructure

**R-001** The system is deployed on Unraid via Docker Compose. All containers
share an internal Docker network; only NGINX Proxy Manager exposes public ports.

**R-002** The frontend is served at `dinnerbears.com`, with city subdomains
`cincinnati.dinnerbears.com` and `dayton.dinnerbears.com`. Additional cities are
added by config without code changes.

**R-003** City context is resolved server-side from the HTTP `Host` header
subdomain; it is never derived solely from client-supplied input.

**R-004** The NestJS API container has no public ports. All external traffic
reaches it through NGINX (`/api/*` → internal `nestjs-api:3000`).

**R-005** A health check endpoint `GET /api/v1/health` returns HTTP 200 with
`{ status, timestamp, database }` when all subsystems are reachable, and HTTP
503 with `status: "degraded"` plus a per-subsystem breakdown when any are not.

**R-006** All environment secrets (DB credentials, JWT secret, OAuth client IDs,
API keys, VAPID keys) are supplied via `.env` and never hardcoded or committed.

---

## 2. User Registration & Authentication

### 2.1 Invite-Only Registration

**R-007** Open registration is disabled. An account can only be created by
redeeming a valid, unexpired invite link.

**R-008** Member invite links are single-use, expire after 30 days, and record
the inviting member's ID.

**R-009** Admin invite links are unlimited-use within an admin-configured time
gate (maximum 30 days). They are revocable at any time.

**R-010** Google OAuth and Facebook OAuth account creation still requires a valid
invite link. OAuth may not be used to bypass the invite requirement.

**R-011** The registration form collects: full name, email address, password,
and city. All fields are validated server-side via DTO + ValidationPipe.

### 2.2 Authentication

**R-012** Passwords are hashed with Argon2id (or bcrypt work factor ≥ 12).
Plaintext passwords are never stored or logged.

**R-013** Authentication sessions use JWTs stored in HTTP-only, Secure,
SameSite=Strict cookies. JWTs are never returned to or stored in
`localStorage` or `sessionStorage`.

**R-014** Login supports three methods: email + password, Google OAuth, and
Facebook OAuth. All three resolve to the same `users` row via `oauth_accounts`.

**R-015** Auth endpoints (`/api/v1/auth/*`, `/api/v1/users/register`) are rate-
limited via `@nestjs/throttler`.

**R-016** Login sessions are tracked in `login_sessions` with device
fingerprinting (user-agent, IP, geoip-lite lookup). Logins from a new device
trigger a security-alert email and in-app notification.

### 2.3 Account Management

**R-017** Members can view and edit their profile: name, email, city, profile
photo, and linked OAuth accounts.

**R-018** Members can change their password from the profile Security tab.

**R-019** A password-reset flow sends a time-limited token via email (Brevo
Priority 1 template). The token is single-use and invalidated on redemption.

**R-020** Account deletion is soft-deleted on request. A 30-day recovery window
is provided. On day 30 all PII is hard-deleted and the row is anonymised.

---

## 3. Email System

**R-021** All outbound email is queued in the `email_queue` MySQL table. Email
is never sent inline during a request.

**R-022** An `EmailDispatcherService` cron runs every 5 minutes, dequeues
messages in priority order, and dispatches them via the active provider.

**R-023** The primary email provider is Brevo (limit: 300 messages/day). Gmail
SMTP via Nodemailer is the overflow fallback (limit: 500 messages/day).
Combined ceiling is 800 messages/day.

**R-024** Provider selection is controlled by a flag in `email_provider_config`.
An admin can toggle the overflow on/off from the admin panel.

**R-025** The system supports nine transactional email templates: (1) invite,
(2) registration confirmation, (3) password reset, (4) password changed,
(5) new security alert, (6) event published, (7) RSVP confirmation,
(8) event reminder (24 h before), (9) account deletion confirmation.

**R-026** Member notification preferences (per template opt-in/out) are stored
in `notification_preferences` and respected by the dispatcher.

---

## 4. Restaurant Database

**R-027** Restaurants are created and maintained by admins and moderators.
Regular members have read-only access.

**R-028** Each restaurant record stores: name, address, lat/lng (geocoded from
address), phone, website URL, description, city, and up to N photos.

**R-029** Address geocoding to lat/lng is performed server-side via a configured
geocoding API. The result is stored; re-geocoding is triggered only on address
change.

**R-030** Photos are uploaded via multipart form, validated for MIME type and
extension server-side, and stored on an Unraid volume outside the web root.

**R-031** The restaurant list supports search by name and filter by city.

---

## 5. Event System

**R-032** Events are weekly and scoped to a single city. One event per week per
city is the expected cadence; the system does not enforce a hard limit.

**R-033** When creating an event, selecting a restaurant pre-fills the event
fields (name, address, description) from the restaurant record as a snapshot.
Subsequent edits to the restaurant do not retroactively change the event.

**R-034** Event states: `draft` → `published` → `cancelled`. Only published
events are visible to non-admin members.

**R-035** Members can RSVP to published events. They can remove their RSVP at
any time before the event date.

**R-036** The event page displays two RSVP counts independently when Facebook
sync is active: "X attending via website · Y attending via Facebook" (see R-052).

**R-037** Events support a standard description block (from a config table) plus
a per-event "additional info" free-text field.

**R-038** Calendar export is available for each event: `.ics` download (RFC
5545), Google Calendar URL, and Apple Calendar deep link.

---

## 6. Facebook Integration

### 6.1 Group Configuration

**R-039** Two Facebook groups are configured in admin settings.

**R-040** **Group 1** is the admin-managed group: the admin is a group admin on
Facebook. It is **city-scoped** — Cincinnati and Dayton each have their own
Group 1 configured separately in the Cities admin tab.

**R-041** **Group 2** is a secondary group the admin can post to but does not
administer on Facebook. It is **scoped to Dayton only**. Cincinnati events do
not post to Group 2.

### 6.2 Group 1 — Full Two-Way Sync

**R-042** When a website event is published, a corresponding Facebook Event is
created inside Group 1 for the matching city. This requires the admin token
to have `publish_to_groups` permission (see R-052).

**R-043** Facebook Event creation is triggered automatically on publish by
default. An admin toggle in settings can switch the trigger to manual, in which
case an admin action explicitly initiates creation.

**R-044** The system stores the Facebook Event ID returned from the Graph API
alongside the website event record, for use in subsequent sync calls.

**R-045** A scheduled job runs hourly and pulls the attendee count (the
`attending_count` field from the Facebook Event) for every active event that
has a linked Facebook Event ID. Only the aggregate count is stored — no names
or email addresses are ever retrieved or stored.

**R-046** After each attendee-count pull (R-045) and after each new website
RSVP, the system updates the Facebook Event description to append the
current website RSVP count. The appended note reads:
> "X member(s) have also RSVP'd via the DinnerBears website."

**R-047** The website event page displays both counts independently:
`"X attending via website · Y attending via Facebook"`.
If the Facebook count is unavailable (sync error, event not yet created), only
the website count is shown; no placeholder is shown for the Facebook count.

### 6.3 Group 2 — Dayton Post-Only Announcement

**R-048** When a Dayton website event is published, an announcement post is made
to Group 2. The post contains the event name, date, time, restaurant name, and
a direct link back to the website event page. Cincinnati events do not post to
Group 2.

**R-049** Group 2 posting is triggered automatically on publish by default. An
admin toggle in settings can switch it to manual, matching the same trigger
model as R-043.

**R-050** No Facebook Event is created in Group 2. No data is read back from
Group 2. There is no description update to Group 2 posts.

### 6.4 Token & Permissions

**R-051** Facebook API calls use a user access token obtained when an admin
authenticates via Facebook OAuth (the same Meta App used for Facebook Login).

**R-052** The required Facebook permissions are: `publish_to_groups` (for event
creation and group posting) and `public_profile` (baseline). The Meta App must
complete Facebook App Review before `publish_to_groups` is usable in production.

**R-053** The admin user token is stored encrypted server-side. The system
handles token refresh automatically; if a refresh fails, admins are alerted
via an in-app notification and email.

**R-054** If a Facebook API call fails (rate limit, token expiry, network error),
the failure is logged to the `audit_log`, the event record's Facebook status
field is updated to `error`, and an admin in-app notification is created. No
silent failures are permitted.

---

## 7. Push Notifications

**R-055** The Angular frontend registers a Web Push service worker using VAPID
keys. Push subscriptions are stored in `push_subscriptions` per user per device.

**R-056** iOS members who have added the site to their Home Screen receive push
notifications via the PWA service worker. An onboarding banner prompts iOS users
to add to Home Screen on first visit.

**R-057** In-app notifications are displayed in a bell icon with an unread badge.
The bell dropdown shows the latest N notifications with mark-as-read.

**R-058** Notification delivery is real-time via SSE or 60-second polling
(implementation choice deferred to Phase 7).

**R-059** Members can configure per-type notification preferences (email on/off,
push on/off) from the Profile → Notifications tab.

---

## 8. Announcements

**R-060** Admins and moderators can create announcements scoped to a city or
all cities. Announcements have `draft` and `published` states.

**R-061** Published announcements support member comments.

**R-062** Members can flag comments for moderator review. Flagged content
appears in a moderation queue; moderators receive an in-app notification.

---

## 9. Admin Panel

**R-063** The admin panel is accessible only to users with the `admin` role.
All admin endpoints enforce server-side role checks.

**R-064** Admin panel sections: Users, Invites, Restaurants, Events,
Announcements, Email Queue, Notifications, Cities, Audit Log, Config.

**R-065** **Users tab:** view all members, change roles, suspend accounts,
initiate or cancel account deletion.

**R-066** **Invites tab:** generate invite links, view pending and used links,
revoke any link.

**R-067** **Cities tab:** add a city, configure its Group 1 Facebook group,
configure the Dayton-only Group 2 Facebook group, toggle auto-post on/off for
each trigger (event publish → FB Event, event publish → Group 2 post).

**R-068** **Email dashboard:** show Brevo and Gmail send counts for today, toggle
overflow provider, retry failed sends.

**R-069** **Audit Log tab:** filterable read-only log of key actions (see R-071).

---

## 10. Security

**R-070** All SQL is executed via TypeORM parameterized queries. Raw string
interpolation into SQL is prohibited.

**R-071** The following actions are written to `audit_log`: login, logout,
password change, role change, event create/edit/cancel, invite create/revoke,
Facebook post triggered, account deletion request, account restoration.

**R-072** A global exception filter catches all unhandled exceptions and returns
a sanitised error envelope `{ statusCode, message, timestamp, path }`. Stack
traces are never exposed to API consumers.

**R-073** File uploads validate both MIME type and file extension server-side.
Uploaded files are stored outside the web root on the Unraid volume.

**R-074** Server-side role checks are enforced on every protected route.
Client-side role state is used only for UI rendering and is never trusted for
access control.

**R-075** A pre-launch security checklist (OWASP Top 10 + items above) must be
signed off before Phase 8 is marked complete.

---

## 11. Non-Functional Requirements

**R-076** Mobile-first responsive design: usable at 375 px, 768 px, and 1280 px
breakpoints. Angular Material components are used wherever a suitable component
exists.

**R-077** All API routes are prefixed `/api/v1/`. Route versioning is applied
globally in NestJS main.ts.

**R-078** TypeScript strict mode is enabled in both the Angular and NestJS
projects. No `any` escapes without an explanatory comment.

**R-079** ESLint and Prettier are configured and must pass with zero errors in
CI before a phase is marked complete.

**R-080** Database schema changes are managed exclusively via TypeORM migrations.
`synchronize: false` is enforced in the TypeORM config. Manual DB edits are
prohibited.

**R-081** The `docker compose up` command from a clean checkout (with a valid
`.env`) must produce a fully functional stack within 2 minutes on the Unraid
host.

---

## 12. Historical Restaurant Import (Phase 4.5)

**R-082** A one-time utility script pulls all past events from Group 1 (the
admin-managed Facebook group) via the Facebook Graph API. The script uses the
same admin user token and `publish_to_groups` permission model as the live
integration (R-051–R-052).

**R-083** The import script exports pulled event data to a `.xlsx` spreadsheet
containing the following columns: Event Title, Event Date, Location Name,
Address, and Notes. This file is used for manual review and cleanup before
import.

**R-084** A second import script reads the reviewed `.xlsx` file and inserts
records into the `restaurants` table. Duplicate detection is performed by
restaurant name (case-insensitive); existing records are skipped, not
overwritten.

**R-085** Address geocoding (R-029) runs automatically on each imported
restaurant record during the import script execution.

**R-086** This import is treated as a one-time setup operation. It is run via
Claude Code directly against the database, not exposed as a UI feature. The
admin may use HeidiSQL to manually edit or remove imported records after the
fact.

**R-087** The historical import is prioritized as **Phase 4.5**, between the
Email System (Phase 4) and the Restaurant Database UI (Phase 5), so that the
restaurant table is pre-populated before the restaurant management UI is built.
