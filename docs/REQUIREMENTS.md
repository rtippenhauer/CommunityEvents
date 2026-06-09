# DinnerBears — Product Requirements

_Last updated: 2026-06-09_

Requirements are numbered R-001 … R-NNN and grouped by domain. Each item is a
testable statement of what the system must do. Implementation details live in
CLAUDE.md, PHASES.md, and the module-level CLAUDE.md files.

---

## 1. Platform & Infrastructure

**R-001** The system is deployed on Unraid via Docker Compose. All containers
share an internal Docker network; only NGINX Proxy Manager exposes public ports.

**R-002** The frontend is served at `dinnerbears.com`, with city subdomains
`cincinnati.dinnerbears.com` and `dayton.dinnerbears.com`. Additional cities
are added by config without code changes.

**R-003** City context is resolved server-side from the HTTP `Host` header
subdomain; it is never derived solely from client-supplied input.

**R-004** The NestJS API container has no public ports. All external traffic
reaches it through NGINX (`/api/*` → internal `nestjs-api:3000`).

**R-005** A health check endpoint `GET /api/v1/health` returns HTTP 200 with
`{ status, timestamp, database }` when all subsystems are reachable, and HTTP
503 with `status: "degraded"` when any are not.

**R-006** All environment secrets are supplied via `.env` and never hardcoded
or committed.

**R-007** A placeholder static site (landing page, privacy policy, terms of
service) is deployed at `dinnerbears.com` during Phase 1 to satisfy Facebook
App domain verification requirements.

---

## 2. User Registration & Authentication

### 2.1 Invite-Only Registration

**R-008** Open registration is disabled. An account can only be created by
redeeming a valid, unexpired invite link.

**R-009** Every account has a traceable invite lineage. The `invited_by` field
records the member or admin who issued the invite. Campaign links record the
source Facebook group.

**R-010** Google OAuth account creation requires a valid invite link. OAuth
may not be used to bypass the invite requirement.

**R-011** The registration form collects: full name, email address, password
(optional for OAuth), and city. All fields are validated server-side.

**R-012** Email-only registrations require email verification before the account
is activated. Unverified accounts are in `pending` status and are soft-purged
after 48 hours if not confirmed.

**R-013** Members can request a new verification email if the original expired.

### 2.2 Invite Types

**R-014** The system supports five invite types:

| Type | Uses | Expiry | Created by | Purpose |
|---|---|---|---|---|
| `member` | 1 | 48 hours | Any member | Direct personal invite |
| `admin` | Unlimited | Up to 30 days | Admin | Admin onboarding gate |
| `campaign_facebook` | Unlimited | Up to 30 days | Admin only | Facebook group migration |
| `guest_rsvp` | 1 | Event date | Member (via RSVP) | Email +1 invite |
| `shareable_rsvp` | 1 | Event date | Member (via RSVP) | Copy link +1 invite |

**R-015** Member invites (`member` type) are tied to the invitee's specific
email address. If someone else attempts to redeem the link it is rejected.
Only one active pending invite per invitee email is allowed at a time.

**R-016** Campaign Facebook invites (`campaign_facebook` type) are admin-only.
When creating one, the admin selects which configured Facebook group the link
is for, sets an expiry date (maximum 30 days), and optionally sets a use cap.
Members who register via a campaign link have their lineage recorded as:
`invite_source = facebook_group`, `invite_source_name = [group name]`.

**R-017** Campaign links expire after a maximum of 30 days. This prevents
members finding old Facebook posts and using stale links to gain access.
Expired links show a friendly message directing the visitor to contact admin.
Admins renew links by generating a new one — old links cannot be extended.

**R-018** Only one campaign link per Facebook group should be active at a time.
The admin UI warns if an active link already exists for the selected group.

### 2.3 Authentication (Phase 2 — Google OAuth)

**R-019** Phase 2 implements Google OAuth as the sole login method.

**R-020** Authentication sessions use JWTs stored in HTTP-only, Secure,
SameSite=Strict cookies. JWTs are never stored in `localStorage` or
`sessionStorage`.

**R-021** Auth endpoints are rate-limited via `@nestjs/throttler`.

**R-022** Login sessions are tracked in `login_sessions` with device
fingerprinting (user-agent, IP, geoip-lite lookup). Logins from a new device
trigger an in-app security notification.

**R-023** The `users` table tracks `last_login_at` and `login_count` for
activity monitoring.

### 2.4 Authentication Expansion (Phase 6)

**R-024** Phase 6 adds Facebook OAuth login, reusing the Meta App token
obtained during Phase 3.5.

**R-025** Phase 6 adds email + password login with email verification,
password reset, and password change flows.

**R-026** All three login methods (Google, Facebook, email) resolve to the
same `users` row via `oauth_accounts`.

### 2.5 Account Management

**R-027** Members can view and edit their profile: name, email, city, profile
photo, and linked OAuth accounts.

**R-028** Account deletion is soft-deleted on request with a 30-day recovery
window. On day 30 all PII is hard-deleted and a one-way hash of the email
is retained in `email_suppressions`.

**R-029** When a previously suppressed email re-registers:
- `unsubscribed` → account created with `email_status = unsubscribed`
- `bounced` → account flagged for admin review before activation
- `complained` → registration blocked; admin must manually approve

### 2.6 Inactivity Management

**R-030** A scheduled job monitors `last_login_at` and enforces:
- **60 days** — re-engagement email sent
- **90 days** — final warning email sent
- **120 days** — account automatically soft-deleted
- **150 days** — account hard-deleted, email hash retained

**R-031** Inactivity emails are skipped if `email_status` is not `active`.
The deletion timeline proceeds regardless of email status.

**R-032** Admin panel shows inactivity segments: active, 60+ days inactive,
90+ days inactive, pending hard-delete.

---

## 3. Email System (Phase 5)

### 3.1 Queue & Dispatch

**R-033** All outbound email is queued in `email_queue`. Email is never sent
inline during a request.

**R-034** An `EmailDispatcherService` cron runs every 5 minutes, dequeues in
priority order, and dispatches via the active provider.

**R-035** Primary provider: Brevo (300/day). Overflow fallback: Gmail SMTP
via Nodemailer (500/day). Combined ceiling: 800/day.

**R-036** Provider selection is admin-togglable from the email dashboard.

**R-037** The system supports eleven transactional email templates:
(1) invite, (2) email verification, (3) registration confirmation,
(4) password reset, (5) password changed, (6) security alert,
(7) event published, (8) RSVP confirmation, (9) event reminder (24h),
(10) account deletion confirmation, (11) re-engagement (60-day and 90-day
variants).

**R-038** Member notification preferences are stored in
`notification_preferences` and respected by the dispatcher.

### 3.2 Email Status & Bounce Handling

**R-039** Each user has an `email_status`:
- `pending` — not yet verified
- `active` — emails send normally
- `unsubscribed` — opted out via unsubscribe link
- `bounced` — hard bounce from Brevo webhook
- `complained` — spam complaint from Brevo webhook

**R-040** Brevo send-event webhooks are consumed for delivery, open, bounce,
block, and spam complaint. The `email_queue` record is updated with the
actual Brevo delivery status.

**R-041** On hard bounce: `email_status = bounced`, pending emails cancelled,
admin notified via in-app notification.

**R-042** On spam complaint: `email_status = complained`, pending emails
permanently cancelled. Account stays active but email is disabled. On next
login a banner informs the member and instructs them to contact admin.
Not self-service reversible — admin must manually restore after the member
resolves it on their email provider's side.

**R-043** On unsubscribe: `email_status = unsubscribed`, pending emails
cancelled. On next login a dismissible banner offers a Re-subscribe option.

**R-044** Re-subscribe calls `DELETE /v3/contacts/blockedContacts/{email}`
on the Brevo API to remove from the suppression list, then sets
`email_status = active`. Available only for `unsubscribed` status —
not `bounced` or `complained`.

---

## 4. Restaurant Database (Phase 3)

**R-045** Restaurants are created and maintained by admins and moderators.
Members have read-only access.

**R-046** Each restaurant stores: name, address, lat/lng (geocoded), phone,
website URL, description, city, and photos.

**R-047** Geocoding runs server-side on save and is re-triggered only on
address change.

**R-048** Photos are uploaded via multipart form, validated for MIME type and
extension, and stored on the Unraid volume outside the web root.

**R-049** The restaurant list supports name search and city filter.

---

## 5. Event System (Phase 4)

**R-050** Events are weekly and city-scoped.

**R-051** Selecting a restaurant pre-fills event fields as a snapshot.
Subsequent restaurant edits do not retroactively change the event.

**R-052** Event states: `draft` → `published` → `cancelled`. Only published
events are visible to non-admin members.

**R-053** Events support a standard description block (from `app_config`)
plus a per-event additional info field.

**R-054** Calendar export: `.ics` download, Google Calendar URL, Apple
Calendar deep link.

---

## 6. RSVP System (Phase 4)

### 6.1 Member RSVPs

**R-055** Members can RSVP to published events and remove their RSVP any
time before the event date.

**R-056** When RSVPing, members select additional guests (0–9) and for each
choose one of:
- **Name them** — enter guest name for headcount
- **Send by email** — enter email; system sends a personal RSVP management link
- **Copy shareable link** — unique one-time link to share via any channel

**R-057** All guest links are tied to the inviting member's ID for lineage
tracking. Links expire at the event date.

**R-058** Only one active guest link per invitee email per event is allowed.

### 6.2 Guest RSVPs

**R-059** Published event pages show a "RSVP without an account" form
collecting name and email only.

**R-060** On guest RSVP:
- Guest counted immediately in headcount
- Confirmation email sent with: event details, cancel link (single-use
  token), and optional invite ("Your invite is waiting →" pre-filled)
- Invite link in confirmation expires after 30 days

**R-061** If a guest converts to a full account their guest RSVP is
automatically promoted to a member RSVP — no duplicate created.

**R-062** Guests who arrive via a member's shareable link are tied to that
member in the lineage. Guests who arrive via admin's Facebook campaign link
are tied to the admin and the source Facebook group.

### 6.3 RSVP Display

**R-063** Event page headcount display:
- Members attending (count + names visible to all members)
- Guests attending (count only — names/emails never shown to non-admins)
- Additional guests count
- **Total Seats Needed** (sum of all, prominently shown)

**R-064** Admins see full breakdown: member names, guest names and emails,
who invited each guest, per-member additional guest counts.

**R-065** Total Seats Needed is the figure given to the restaurant for
reservations and is the most prominent number on the admin event page.

---

## 7. Invite Lineage & Community Log

**R-066** Every account has a traceable lineage via `invited_by` on `users`.

**R-067** An Invite Log records: who invited whom, invite type, source
Facebook group (if campaign), date, and redemption status.

**R-068** The Invite Log is admin-only initially. A future release may expose
a public Community Wall.

**R-069** Admins can view the full invite tree for any member — upward to
the founder and downward to all invitees.

**R-070** Members can view their own invite history only: who they invited
and the status of those invites.

---

## 8. Facebook Integration (Phase 4+)

**R-071** Facebook group integration is outbound sharing only. Meta's
deprecation of the Groups API prevents automated posting or sync.

**R-072** Each published event page has a **"Share to Facebook"** button
(admin only) that opens Facebook's composer pre-filled with event details
and a link back to the website event page.

**R-073** A **"Copy Post Text"** button copies formatted event text to
clipboard for posting to any platform.

**R-074** Facebook group names and URLs are stored as reference data only.
No API calls are made to Facebook groups.

**R-075** Facebook OAuth login is added in Phase 6, reusing the Meta App
token from Phase 3.5. It uses only `public_profile` and `email` permissions.

**R-076** Up to 3 Facebook groups can be configured in admin settings, each
with a name, URL, and group ID. Campaign invite links are tied to one of
these configured groups.

---

## 9. Push Notifications (Phase 7)

**R-077** Web Push service worker using VAPID keys. Subscriptions stored per
user per device.

**R-078** iOS PWA push via Add-to-Home-Screen. Onboarding banner on first
visit.

**R-079** In-app bell notification with unread badge and mark-as-read.

**R-080** SSE or 60-second polling (decided in Phase 7).

**R-081** Per-type notification preferences in Profile → Notifications tab.

---

## 10. Announcements (Phase 7)

**R-082** Admins and moderators create city-scoped or global announcements
with draft/published states.

**R-083** Published announcements support member comments.

**R-084** Members can flag comments. Flagged content appears in a moderation
queue with moderator notification.

---

## 11. Admin Panel (Phase 8)

**R-085** Admin panel is role-gated. All admin endpoints enforce server-side
role checks.

**R-086** Sections: Users, Invites, Restaurants, Events, Announcements,
Email Queue, Notifications, Cities, Audit Log, Config.

**R-087** **Users tab:** view members, change roles, suspend, delete, view
email status, view inactivity segments, manually override email suppression.

**R-088** **Invites tab:** generate all invite types, view/revoke links,
view full invite tree, view Invite Log.

**R-089** **Cities tab:** configure Group 1 per city, Group 2 for Dayton,
manage up to 3 Facebook group configurations for campaign links.

**R-090** **Email dashboard:** Brevo/Gmail send counts, overflow toggle,
retry failed sends, bounce and complaint log.

**R-091** **Audit Log tab:** filterable, read-only.

---

## 12. Security

**R-092** All SQL via TypeORM parameterized queries. No raw string
interpolation.

**R-093** Audit log captures: login, logout, password change, role change,
event create/edit/cancel, invite create/revoke, Facebook share triggered,
account deletion, account restoration, email status change, suppression
override.

**R-094** Global exception filter returns sanitised error envelope. Stack
traces never exposed to API consumers.

**R-095** File uploads validate MIME type and extension server-side.

**R-096** Server-side role checks on every protected route. Client-side
role state used for UI only.

**R-097** Pre-launch OWASP Top 10 security checklist signed off before
Phase 8 is complete.

---

## 13. Non-Functional Requirements

**R-098** Mobile-first: usable at 375px, 768px, 1280px. Angular Material
used wherever a suitable component exists.

**R-099** All API routes prefixed `/api/v1/`. Route versioning applied
globally.

**R-100** TypeScript strict mode in Angular and NestJS. No `any` without
comment.

**R-101** ESLint and Prettier pass with zero errors before each phase is
marked complete.

**R-102** Schema changes via TypeORM migrations only. `synchronize: false`
enforced.

**R-103** `docker compose up` from clean checkout produces a working stack
within 2 minutes.

---

## 14. Historical Restaurant Import (Phase 3.5)

**R-104** One-time script pulls past events from Group 1 via Facebook Graph
API using admin OAuth token. Read-only — does not require `publish_to_groups`.

**R-105** Script exports to `.xlsx`: Event Title, Date, Location Name,
Address, Notes.

**R-106** Import script reads reviewed `.xlsx`, inserts into `restaurants`
table. Duplicate detection by name (case-insensitive). Geocoding runs
automatically.

**R-107** One-time Claude Code operation — not a UI feature. Admin cleans
data in HeidiSQL after import.

---

## 15. Restaurant Ratings & Attendance (Phase TBD)

**R-108** Members may only submit a rating for a restaurant tied to an event
they attended. The system enforces this by checking the member's verified
attendance record before allowing a rating submission. Members who did not
attend see the rating UI as disabled with a tooltip explaining why.

**R-109** Moderators may mark members as attended for a given event after the
event concludes. Attendance is recorded as a distinct `attended` boolean on the
RSVP record, separate from RSVP status. A member can have `attended: true`
even if their RSVP was not GOING (walk-ins, late adds). Only moderators may
set this field. **DB impact:** Add `attended` boolean column to `event_rsvps`.

**R-110** The system calculates a per-member attendance probability score
derived from the member's historical ratio of GOING RSVPs to verified
attendance. Visible to moderators on the event attendee list to assist with
reservation headcount planning. Not visible to standard members.

**R-111** Each restaurant displays an aggregate rating calculated from all
attendance-verified member submissions. Ratings are submitted per-event visit
and aggregated across all visits. Rating dimensions (Food, Service, Value,
Noise — each 1–5 stars) plus an optional text comment are confirmed before
implementation. **DB impact:** New table `event_ratings` (member_id, event_id,
restaurant_id, food, service, value, noise, comment, created_at).

---

## 16. Threaded Event Discussion (Phase TBD)

**R-112** Each event has a threaded discussion board. Any member may post a
top-level comment. Replies nest one level deep under a top-level comment (no
infinite nesting). Discussions persist after the event concludes and are
visible to all members. Moderators may delete any post; members may delete
their own. Soft delete only. **DB impact:** New tables `event_comments` and
`event_comment_replies`.

---

## 17. Event RSVP Disclaimer & Cutoff (Phase TBD)

**R-113** All event detail pages display a standard platform-wide disclaimer
stored as a config constant (not hardcoded in the template). The disclaimer
communicates: (1) members are expected to mark GOING by 5:00 PM on the day of
the event, (2) only GOING RSVPs count for reservation purposes — MAYBE is not
counted, (3) the event generally begins at 6:30 PM with members commonly
arriving around 6:00 PM.

**R-114** The system does not accept new GOING RSVPs after 5:00 PM on the day
of the event. Members attempting to RSVP after the cutoff are shown a message
explaining the deadline has passed and to contact a moderator if needed.
Moderators retain the ability to add or adjust RSVPs after the cutoff regardless.

---

## 18. Venue Moderator Notes & Contact (Phase TBD)

**R-115** Each restaurant record includes a moderator-only free-text notes
field for capturing operational context (reservation tips, parking notes,
service observations). Not visible to standard members under any circumstance.
Visible only to moderator and admin roles. **DB impact:** Add `moderator_notes`
(longtext, nullable) to `restaurants`.

**R-116** The restaurant record supports a structured moderator-only contact:
contact name, contact phone, and contact email. Distinct from the public-facing
restaurant phone/website fields. Used to record the specific person to call for
reservations. Visible to moderators and admins only. **DB impact:** Add
`contact_name` (varchar 100), `contact_phone` (varchar 30), `contact_email`
(varchar 150) — all nullable — to `restaurants`.

---

## 19. Avatar System (Phase TBD)

**R-117** The avatar picker does not use a hardcoded list. On application
startup, the backend scans the avatar asset directory for `*.png` and `*.jpg`
files and returns the list via `GET /api/v1/avatars` (no auth required). Any
new bear image dropped into the directory is automatically available without a
code change or redeployment. **Supersedes** the hardcoded `PRESET_AVATARS`
array in the profile component.

**R-118** Avatar display names are derived from filenames at runtime: strip
the `bear-` prefix, remove the file extension, capitalize the first letter.
No separate name mapping file is maintained. This transform runs on the
frontend as a pure utility function. (Examples: `bear-bbq.png` → **Bbq**,
`bear-nascar.png` → **Nascar**.)

**R-119** The member profile avatar picker includes an **"I Feel Lucky"**
button that selects a random avatar from the discovered list, explicitly
excluding the member's currently selected avatar. The selection is previewed
immediately but not saved until the member confirms via the normal save action.
Pure frontend logic — no additional API call required.

---

## 20. Dark Warm Theme (Phase TBD)

**R-120** The entire site uses a dark warm-brown color palette. No page
renders with white or light-gray backgrounds. The Angular Material theme
background and surface tokens are updated globally. The palette is defined
once and applied across both the landing page and all post-login app pages.

Approved palette:

| Role | Hex | Notes |
|---|---|---|
| Page background | `#3d2210` | Primary surface — all pages |
| Nav / footer background | `#311a0a` | Slightly darker than page bg |
| Card surface | `#4d2c14` | All card and panel surfaces |
| Border color | `#5e3418` | All borders and dividers |
| Primary accent (amber) | `#e8a44a` | Headings, icons, active states |
| Body text | `#eab87a` | Primary readable text |
| Secondary text | `#9a6840` | Metadata, labels, hints |
| Button text (RSVP / Going) | `#ffffff` | White — must be legible on dark button backgrounds |
| Going button background | `#0d2b18` | Dark green |
| Going button border | `#1d5c32` | Green border |

RSVP and Going button text must be explicitly set to `#ffffff` — Material
theme defaults are insufficient against dark button backgrounds.

---

## 21. CMS Legal Pages (Phase TBD)

**R-121** The Terms and Conditions and Privacy Policy pages are stored in the
database as moderator-editable content, not hardcoded in the Angular app. A
moderator can update either document through the admin UI without a code change
or redeployment. Both pages render using the standard site theme (dark
background, site typography, full nav). **Supersedes** the static placeholder
files from R-007 for Terms and Privacy. **DB impact:** New table `legal_pages`
(id, page_type enum[terms|privacy], content longtext, published boolean,
created_by FK users, created_at). Public endpoint: `GET /api/v1/legal/:type`.
Admin endpoint: `POST /api/v1/admin/legal/:type` (moderator guard). Angular
routes: `/terms`, `/privacy` — content rendered as sanitized HTML via
`DomSanitizer`.

**R-122** Each update to the Terms or Privacy content creates a new versioned
record with a timestamp and the moderator who made the change. The current
published version is flagged with a `published` boolean. Provides an audit
trail and enables future re-consent prompts if material changes are made.
