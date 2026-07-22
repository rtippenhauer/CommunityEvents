# DinnerBears — Development Phases

Update `CLAUDE.md` "Current Development Phase" when moving to a new phase.

---

## Phase 1 — Project Foundation & Design System ✅ Complete

- Docker Compose scaffold (nginx, angular, nestjs-api, mysql)
- Angular 19 project init — standalone, routing, SCSS
- Angular Material custom theme (DinnerBears blue #1E4D8C)
- Responsive shell layout: MatToolbar nav, MatSidenav mobile, footer
- City selector dropdown in nav
- NGINX internal proxy: /api/\* → nestjs-api container
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

## Phase 2 — Google Auth & Invite System ✅ Complete

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

## Phase 3 — Restaurant Database UI ✅ Complete

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

## Phase 3.5 — Historical Restaurant Import ✅ Complete

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
Phase 11 when Facebook login is added for members.

---

## Phase 4.1 — Event Core ✅ Complete

- NestJS EventsModule — CRUD, restaurant snapshot on creation
- Event states: draft → published → cancelled
- Event list page — city filter, upcoming/past toggle, MatCard layout
- Event detail page — restaurant, date/time, description
- Admin create/edit event form

**Definition of done:** Admin can create, edit, publish, and cancel events.
Members can view the event list and detail page. Restaurant snapshot is
captured on publish.

---

## Phase 4.2 — Member RSVP ✅ Complete

- Member RSVP — add/remove, 0–9 additional guests dropdown
- +1 options: name them, send by email, copy shareable link
- `shareable_rsvp` invite type activated
- RSVP display: member names, additional guest count, Total Seats Needed

**Definition of done:** Members can RSVP and add additional guests. Shareable
+1 links work. Total Seats Needed is accurate.

---

## Phase 4.3 — Sharing & Calendar Export ✅ Complete

- Share to Facebook button (admin only — pre-fills FB composer)
- Copy Post Text button
- Calendar export — .ics, Google Calendar URL, Apple Calendar deep link

**Definition of done:** Admin can share event to Facebook with pre-filled
text. All three calendar export formats work correctly.

---

## Phase 4.4 — Event RSVP Disclaimer & Cutoff ✅ Complete

- Add platform disclaimer constant (not hardcoded in template) to event detail page:
  - GOING by 5:00 PM day-of
  - MAYBE not counted for reservations
  - Dinner starts 6:30 PM, members arrive ~6:00 PM
- Hard-block new GOING RSVPs after 5:00 PM on event day
- Cutoff message shown to members; moderators retain full override
- Admin/mod RSVP controls bypass the cutoff check

**Definition of done:** Disclaimer visible on all event detail pages. GOING
RSVP hard-blocked after 5:00 PM day-of for standard members. Moderators
can still adjust RSVPs after cutoff.

---

## Phase 4.6 — Avatar System (dynamic) ✅ Complete

- NestJS `GET /api/v1/avatars` endpoint: scans avatar asset directory for
  `*.png` and `*.jpg`, returns `[{ filename, displayName }]`, no auth required
- Display name utility: strip `bear-` prefix, strip extension, capitalize first
  letter — pure function on frontend, no server-side mapping
- Profile avatar picker refactored: remove hardcoded `PRESET_AVATARS` array,
  load from `/api/v1/avatars` on init
- "I Feel Lucky" button: picks a random avatar excluding the current one,
  previews it immediately, saves only on normal save action

**Definition of done:** Adding a new `bear-*.jpg` to the avatar directory
makes it appear in the picker without any code change or redeployment.
"I Feel Lucky" always produces a different avatar. Display names derive
correctly from filenames.

---

## Phase 5 — Email System ✅ Complete

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

## Phase 5.5 — Guest RSVP (email-complete) ✅ Complete

- Guest confirmation email with cancel link + optional DinnerBears invite offer
- Guest invite link (30-day expiry) generated on confirmation, linked to inviting member for lineage
- `guest_rsvp` invite type activated
- Admin event page: full attendee breakdown — names, emails, who invited whom
- RSVP display updated to include confirmed guest count

**Definition of done:** Guests can RSVP without an account, receive a
confirmation email with a cancel link, and optionally join DinnerBears via
the invite offer. Admin sees the full attendee breakdown with lineage.

---

## Phase 6 — Feedback Board, Release Notes & Versioning ✅ Complete

- DB migrations: add `title` (varchar 200), `is_private` (boolean default false),
  `upvote_count` (int default 0) to existing `feedback` table; reconcile status
  enum to `open`, `in_progress`, `resolved`, `shipped`, `closed`, `wont_fix`;
  keep existing `seen_at` and `comment` category
- DB: `feedback_notes` table (id, feedback_id FK, author_id FK, content text,
  is_admin_only boolean default false, created_at)
- DB: `feedback_upvotes` table (id, feedback_id FK, member_id FK, created_at;
  UNIQUE on feedback_id + member_id)
- DB: `releases` table (id, version varchar 20, title varchar 200, body text,
  released_at datetime, created_by FK members)
- DB: `release_feedback` join table (release_id FK, feedback_id FK)
- NestJS: extend FeedbackModule — upvote toggle, threaded notes (with
  is_admin_only), privacy flag, open-bugs admin query
- NestJS: ReleasesModule — public list + detail, admin create/publish with
  package.json version bump in both frontend/ and api/
- Quill rich text editor installed and integrated for description, notes,
  and release body fields; server-side HTML sanitization (sanitize-html)
- Member feedback board `/feedback` — list with upvote counts, type/status
  badges, private lock icon; filter tabs (All / Bugs / Features / Comments);
  sort by Most Upvoted or Newest
- `/feedback/new` — submit form (type, title, Quill description, private toggle)
- `/feedback/:id` — ticket detail with upvote button, status banner ("Shipped
  in vX.X.X" links to release), threaded notes, add-note form
- `/updates` — public changelog, no auth required; lists releases newest-first
  with rich text body and community credit section (name or "a community member"
  for private tickets)
- Admin `/admin/feedback` enhanced — full list including private, inline status
  dropdown, admin-only note capability
- Admin `/admin/releases/new` — version field (semver validated), title, Quill
  release notes, ticket linker for resolved tickets, community credit preview,
  publish button
- Member profile stats: bugs reported, features requested, shipped count
- CLAUDE.md updated with Bug-Driven Development and Versioning Workflow sections

**Definition of done:** Members can submit, upvote, and discuss feedback.
Admin can manage status and publish releases linked to resolved tickets.
`/updates` is publicly visible with community credit. Publishing a release
auto-bumps `package.json` in both workspaces. Open-bugs API endpoint
returns current open bug tickets for the agentic workflow.

---

## Phase 7 — Push Notifications & Announcements ✅ Complete

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

## Phase 7.5 — Non-Validated Members & Event Invite Links ✅ Complete

Replaces the earlier Public Event Interest concept. Non-Validated users are real accounts
with limited access — suitable for public Facebook posts where membership can't be
pre-screened.

### Non-Validated User Status

- DB: add `non_validated` to `UserStatus` enum via migration
- Non-Validated users can: view upcoming events, RSVP (Going/Maybe/Not Going),
  view release notes (`/updates`)
- Non-Validated users cannot: invite +1s, invite members, submit feedback,
  post comments or notes on any content
- API guards enforce all restrictions server-side (not just UI)
- Moderator/admin member profile page: shows "Self-Invited" badge instead of
  "Invited By" when `invite_source = 'non_validated_link'`
- Moderator/admin can upgrade Non-Validated → Member via a "Validate Member" button;
  validator must confirm they are vouching for the person (confirmation dialog)
- Admin can also upgrade from the admin users list

### Multi-Use Event Invite Links

- DB: extend `invites` table — add `event_id` FK (nullable), `invite_flavor`
  enum[`member`|`non_validated`]
- Admin-only: generate a multi-use invite link tied to a specific event;
  choose flavor (Member or Non-Validated); set optional use cap and expiry
- Link URL pattern: `/join/:code` — on arrival, shows event card + OAuth signup
- On signup via Non-Validated link: account created with `non_validated` status,
  `invite_source = 'non_validated_link'`, `invite_id` set
- On signup via Member link: standard member account (existing invite flow),
  lineage tracked to event
- Admin event detail: "Invite Links" panel — generate, copy, revoke per-event links

### Maybe RSVP

- Add `maybe` as a valid RSVP status alongside `going` and `not_going`
- RSVP UI: three-option toggle (Going / Maybe / Not Going) for all users
- Event detail: Maybe count displayed separately from Going count
- Cutoff logic (Phase 4.4): only `going` RSVPs count toward venue seat numbers;
  Maybe is informational only
- Non-Validated users can RSVP Going or Maybe (not blocked from RSVPs)

**Definition of done:** Non-Validated accounts can be created via event invite links,
can RSVP and view events/releases, cannot post or invite. Moderators can validate
them to full Member with a vouch confirmation. Maybe RSVP option available to all
users; only Going counts at cutoff. Admin can generate and revoke per-event invite
links for both flavors.

---

## Phase 7.6 — Facebook Event Sharing ✅ Complete

Enhances the existing share/copy flow (Phase 4.3) with event-specific formatting
and per-event invite links.

- **Copy Event Post** button on event detail (admin/mod): generates formatted
  announcement text including event date, restaurant name, and the Non-Validated
  invite link for that event; copies to clipboard
- Admin can generate a Member invite link and a Non-Validated invite link for any
  event; both are shown in the sharing panel for easy copy/paste into Facebook
  groups or direct messages

**Definition of done:** Admin can copy a formatted event post with the correct
invite links in one click. Member and Non-Validated invite links are accessible
from the event sharing panel.

---

## Phase 8 — Venue Moderator Tools ✅ Complete

- Add `moderator_notes` (longtext, nullable) to `restaurants` table via migration
- Add `contact_name` (varchar 100), `contact_phone` (varchar 30),
  `contact_email` (varchar 150) — all nullable — to `restaurants` table
- Restaurant edit form: moderator-only Notes and Contact sections (hidden from
  standard members at API level, not just UI level)
- Restaurant detail page: Notes and Contact sections visible to mod/admin only

**Definition of done:** Moderators can save and view private venue notes and
contact info. Fields are server-side role-gated — standard member API response
omits them entirely.

---

## Phase 9 — Restaurant Ratings (Simplified) ✅ Complete

Simplified from original spec: skipped moderator attendance tracking and
attendance probability scores. Rating eligibility is based on a Going RSVP
to a past event at that restaurant, which is verifiable without separate
attendance marking.

- DB: new `restaurant_ratings` table (member_id, event_id, restaurant_id,
  food, service, value_rating, noise — each 1–5 tinyint, comment text nullable,
  UNIQUE on member_id + event_id)
- `POST /restaurants/:id/ratings` — auth required, validates: Going RSVP exists
  for event, event is past, event was at this restaurant, user is not
  non_validated. Upserts (one rating per member per event).
- `GET /restaurants/:id/ratings` — returns aggregate averages, recent reviews,
  and (if authenticated) list of eligible past events with alreadyRated flag
- Restaurant detail page: aggregate rating card (avg food/service/value/noise,
  overall score, breakdown bars, recent reviews with member name + date)
- Restaurant detail page: "Rate Your Experience" button for members with
  eligible unrated events; 4-dimension star form + optional comment

**Definition of done:** Members with a Going RSVP to a past event at this
restaurant can submit a 1–5 rating on food, service, value, and noise.
Aggregate scores and recent reviews display on the restaurant detail page.
Blocked at API level for non-validated users and non-attendees.

---

## Phase 10 — Threaded Event Discussion & Attendance Tracking ✅ Complete

### Threaded Comments

- DB: `event_comments` (id, event_id, member_id, body, created_at, deleted_at)
- DB: `event_comment_replies` (id, comment_id, member_id, body, created_at, deleted_at)
- Event detail page: discussion section below RSVP panel
- Any member can post a top-level comment
- Replies nest one level deep only (no infinite threading)
- Soft delete: members delete own posts; moderators delete any post
- Discussions persist and remain visible after event concludes

### Attendance Tracking

- DB migration: add `attended` boolean (default null) to `event_rsvps`
- Mod/admin attendance panel on event detail: shown only after event concludes;
  lists all Going RSVPs with checkboxes to mark who actually attended
- `PATCH /events/:id/attendance` — mod/admin only; accepts `[{userId, attended}]`
- Update `getRatingQueue` and `submitRating` in ratings.service.ts:
  require `attended = true` in addition to Going RSVP for rating eligibility

**Definition of done:** Members can comment and reply on event pages.
Moderators can delete any comment. Deleted comments show a "removed" placeholder.
Discussions persist post-event. Moderators can mark actual attendance after an
event concludes. Rating eligibility requires attended = true.

---

## Phase 10.5 — Account Deletion & OAuth Unlinking ✅ Complete

Required for Facebook App Review. Full spec in `docs/Dinnerbears_accountDeletion_requirements.md`.

Partial stubs already exist: `POST /auth/facebook/deletion` (HMAC verification) and `facebook/link` endpoint. Full implementation required.

### Connected Accounts (REQ-DEL-01, REQ-DEL-02, REQ-DEL-03)

- Account Settings page (`/account/settings`) with Connected Accounts section
- Google and Facebook rows showing link status; **Disconnect** button when other auth method exists; "Only login method" label when not
- Email/Password row stubbed (wired in Phase 11)
- `DELETE /api/v1/auth/providers/:provider` — deletes `oauth_accounts` row; clears CDN photo if from that provider (REQ-DEL-07); logs to audit; sends confirmation email; returns `409 ONLY_AUTH_METHOD` if last auth method
- Confirmation dialog and `409` warning dialog in Angular

### Account Self-Deletion (REQ-DEL-04, REQ-DEL-09)

- Danger Zone section on Account Settings (red/amber-warn visual treatment)
- Two-step confirmation: info dialog → type-to-confirm `DELETE` input
- Hidden for admin role (REQ-DEL-09)
- `DELETE /api/v1/users/me` — single DB transaction: sets `status=deleted`, `deleted_at`, `hard_delete_at=+30d`; deletes `oauth_accounts`, `login_sessions`, `push_subscriptions`; nulls CDN photo; logs audit; queues deletion email; invalidates session
- Redirects to `/` with `?deleted=1` toast

### Meta Deletion Callback (REQ-DEL-05)

- Rename/update existing stub: `POST /api/v1/auth/facebook/deletion-callback` (currently at `/facebook/deletion`)
- Full processing: verify HMAC-SHA256 signature; look up by Facebook App-Scoped ID; if other auth exists → delete only `oauth_accounts` row; if only auth → full soft-delete; if not found → return success
- New migration: `facebook_deletion_requests` table (facebook_user_id, confirmation_code UNIQUE, dinnerbears_user_id nullable, status enum[pending|completed], requested_at, completed_at)
- Status lookup: `GET /account-deletion/status?code=` — public Angular page

### Hard-Delete Cron (REQ-DEL-06)

- Daily `@Cron` job: users where `hard_delete_at <= NOW()` and `status = 'deleted'`
- Overwrites PII: `full_name = 'Deleted Member'`, scrambles email, nulls photo/password
- Deletes local photo file from disk
- Updates `facebook_deletion_requests` rows to `completed`
- Logs `account_hard_deleted` to audit

### Public Pages (REQ-DEL-08, REQ-DEL-10)

- `/account-deletion` — public page with self-service instructions (content per spec)
- `/account-deletion/status?code=` — public status lookup for Meta callback
- All auth callbacks reject `status = 'deleted'` before issuing session token

**Definition of done:** Members can disconnect individual OAuth providers (with confirmation) when another auth method exists. Members can delete their account via two-step confirmation. Meta's server-to-server deletion callback processes correctly and returns the required JSON response. Hard-delete cron anonymizes PII after 30 days. Public `/account-deletion` page is accessible without login. Deleted accounts are rejected at all auth entry points.

---

## Phase 10.6 — Content Reporting ✅ Complete

Unified system for members to report inappropriate content across all text-input surfaces, replacing the per-module flagging added in Phase 7 for announcements. See earlier discussion for full scope.

- DB: `content_reports` table (id, reporter_id FK, content_type enum[`event_comment`|`event_comment_reply`|`announcement_comment`|`restaurant_rating`|`profile`], content_id int, reason varchar 500 nullable, status enum[`pending`|`reviewed`|`dismissed`], reviewed_by FK nullable, reviewed_at datetime nullable, created_at)
- One report per member per content item (UNIQUE on reporter_id + content_type + content_id)
- `POST /api/v1/reports` — auth required, member role minimum; validates content exists and is not already reported by this member
- `GET /api/v1/admin/reports` — mod/admin only; lists pending reports with content preview, reporter name, content type, timestamp
- `PATCH /api/v1/admin/reports/:id` — mod/admin only; set status to `reviewed` or `dismissed`; optionally soft-delete the reported content in the same action
- Moderator in-app notification when a new report is filed
- Reusable `<app-report-button>` Angular component: flag icon button, confirmation dialog with optional reason text field; hidden on own content
- Wire report button onto: event comments, event comment replies, announcement comments, restaurant ratings
- Admin/mod report queue in admin panel: pending count badge, list with content preview, one-click dismiss or delete+dismiss
- `profile` content type reserved in enum for when bios/display names become editable

**Definition of done:** Any member can report event comments, replies, announcement comments, and restaurant ratings with an optional reason. Reports appear in the mod/admin queue with a content preview and one-click actions. Moderators receive an in-app notification on each new report. Members cannot report their own content. Duplicate reports from the same member are blocked.

---

## Phase 11 — Facebook OAuth & Email/Password Auth ✅ Complete

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

## Phase 12 — Admin Panel, Audit Log & Security ✅ Complete

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

---

## Phase 13 — CMS Legal Pages ✅ Complete

- DB: `legal_pages` table (id, page_type enum[terms|privacy], content longtext,
  published boolean, created_by FK users, created_at)
- Seed initial content from existing static placeholder files
- Public endpoint: `GET /api/v1/legal/:type` — returns published version, no auth
- Admin endpoint: `POST /api/v1/admin/legal/:type` — moderator guard; creates
  new version, sets published: true, unpublishes prior
- Angular lazy routes `/terms` and `/privacy` — render sanitized HTML via
  `DomSanitizer` within full site shell (dark theme, full nav)
- Admin legal editor UI (textarea + preview)

**Definition of done:** Moderators can update Terms and Privacy through admin
UI without a code change. Public pages render within site theme, not as blank
white pages. Each update creates a versioned audit record.

---

## Phase 14 — Navigation & Invites ✅ Complete

See `memory/project_phase14_nav_invites.md` — completed as v1.0.1.

---

## Post-Launch Backlog 🔄 In Progress

Deferred cleanup items and design spikes. No ordering implied — promote to a
numbered phase when ready to schedule.

### Angular Major Version Upgrade (19 → 22) ✅ Done — see Phase 27

Executed exactly per the plan below: one major hop at a time via `ng
update`, verified on stage before each subsequent hop, Node/Dockerfile
bumped alongside. All 3 flagged `npm audit` vulnerabilities closed. See
Phase 27 for the full account, including what else rode along on the same
branch.

### NestJS v11 Upgrade & Calendar Feed Fix (2026-07-04) ✅ Done — released as v1.3.3

- Upgraded `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`,
  `@nestjs/typeorm` to v11; `@nestjs/config` to v4; `@nestjs/throttler` to v6
  (fixes CVE-2026-35515, an SSE response CRLF-injection bug in
  `SseStream._transform()` — no live SSE endpoints today, but this closes the
  gap before the notifications-module SSE work lands)
- Added Express 5 query-parser insurance (`app.set('query parser', 'extended')`)
  in `main.ts`
- Verified `ThrottlerAuditGuard`, `GoogleCallbackGuard`, the calendar `.ics`
  feed, `GlobalExceptionFilter`, and TypeORM `migrationsRun` behavior against
  v11 — no code changes required, all compiled and behaved identically
- Removed the now-redundant `multer` override (v11's `platform-express`
  ships Multer v2 natively)
- Fixed the calendar `.ics` feed accumulating every past `PUBLISHED` event
  forever (only `CANCELLED` events had a 7-day cutoff) — now filters
  `PUBLISHED` events to `eventDate >= today` so the feed stays bounded

### `/release` Command Added (2026-07-04) ✅ Done

- New Claude Code command (`.claude/commands/release.md`) that bumps
  `"version"` in both `frontend/package.json` and `api/package.json`,
  commits, tags (`v<version>`), pushes to `origin main`, and builds/pushes
  both the `rtippenhauer/dinnerbears:stage` and `:latest` Docker Hub images
- Version numbers only change via this command, and only when Rob gives the
  number explicitly — decoupled from the admin-UI release-notes publish flow
  (`/admin/releases/new`), which writes to the `releases` DB table only and
  never touched `package.json` in the first place
- CLAUDE.md's Versioning Workflow updated to reflect this split

### Uploaded File Auth Gating (2026-07-05) ✅ Done

- Uploads split into per-category subdirectories: `/app/uploads/restaurants/`,
  `/app/uploads/profiles/`, plus the existing `/app/uploads/achievements/` and
  `/app/uploads/custom-icons/`
- Restaurant photos, achievement icons, and custom icons remain public static
  assets (`/api/uploads/<category>/<filename>`, no auth) — restaurant photos
  in particular stay public on purpose, since they're reused in guest-facing
  emails and social/Facebook posts
- Profile photos moved behind a new `GET /api/v1/uploads/profiles/:filename`
  route (`ProfilePhotosController`) guarded by `OptionalJwtAuthGuard` — only
  streamed to signed-in members; anonymous requests get a 401
- Migration `1751300000000-SeparateUploadDirectories` moves existing files on
  disk into their new subfolders and rewrites the stored paths in
  `restaurant_photos.file_path` and `users.profile_photo_path` — runs once
  automatically via `migrationsRun: true` on next deploy
- Known edge case: the public `/api/v1/releases` endpoint (Phase 17) serializes
  a release author's `profilePhotoPath`; if that author uploaded a real photo
  (rather than using a preset avatar), it'll now 401 for anonymous visitors of
  `/updates`. Preset avatars (`/avatars/bear-*.jpg`) are unaffected — they're
  static frontend assets, not uploads.

### Event Card Cleanup ✅ Resolved

Addressed separately by moving event card actions into an overflow ("...")
menu, simplifying the card's information hierarchy without a dedicated
redesign pass.

### Stage Testing Fixes for Upload Auth Gating (2026-07-05) ✅ Done

- Fixed photo uploads failing on stage after the upload-directory migration:
  migrations run as `root` (before the app drops to the unprivileged `nestjs`
  user), so the new `restaurants/`/`profiles/` subfolders came out root-owned
  and the app couldn't write into them. `entrypoint.sh` now does a recursive
  `chmod -R 777 /app/uploads` after migrations run, not just before.
- Widened the qualifying-login dedup window in production from 1 hour to
  12 hours (stage stays 5 min), per Rob
- Fixed visit-count tracking counting background activity (e.g. notification
  polling from a tab left open) as a site visit — moved the tracking from
  `JwtStrategy.validate()` (fires on every authenticated request) to
  `AuthService.me()`, which only runs once per real app bootstrap
  (`APP_INITIALIZER`) — a backgrounded/idle tab no longer inflates the count
- Fixed the sign-up page's splash image on mobile: `.splash-panel` had an
  unconditional `min-height: 400px` outside any media query, which silently
  overrode the intended mobile `height: 240px` — pushed the sign-up form
  (submit button ~178px) below the fold on phones. Verified with a headless
  browser at a 390×844 viewport before/after.
- Fixed remaining Docker Hub scan findings: `@nestjs/platform-express@11.1.27`
  hard-pins an _exact_ `multer@2.1.1`, which has two known DoS advisories
  (patched in `2.2.0`). Removing the `multer` override during the v11 upgrade
  was a mistake — re-added it pinned to `^2.2.0`, which cascaded away every
  other HIGH finding in `npm audit` that was only flagged transitively through
  the vulnerable multer (`@nestjs/core`, `@nestjs/schedule`, `@nestjs/testing`,
  `@nestjs/typeorm`). API workspace is now at 0 known `npm audit` vulnerabilities.
  Frontend's `npm audit` findings are all in build-time-only tooling
  (`@angular/cli`, `@angular-devkit/build-angular`, `vite`, etc.) that never
  ships in the final image — only compiled static output does — so they don't
  apply to what Docker Hub scans.
- Added `scripts/scan-image.sh` — local Trivy scan of a built image
  (`bash scripts/scan-image.sh [stage|latest] [severity-list]`), independent
  of Docker Hub/Scout. Cross-checking the two surfaced a real gap: Trivy's
  Alpine advisory data didn't have the busybox CVE Scout found (Alpine hadn't
  published a formal advisory for it yet) — worth keeping both.
- Audited every place the API returns `profilePhotoPath`, following up on a
  gap the upload auth-gating work introduced: uploaded profile photos now
  require login to view, but a couple of endpoints were still serving that
  path to fully anonymous callers, which would 401 in their browser.
  - `/updates` (`GET /api/v1/releases`, `GET /api/v1/releases/:id`) was fully
    public and exposed the release author's and any credited feedback
    submitter's photo. Gated to validated members and above (server-side via
    `ReleasesController` guards, matching the pattern already used for
    restaurants/calendar/ratings/leaderboard; client-side via
    `validatedMemberGuard` on the `/updates` route).
  - `GET /announcements` and `GET /announcements/:id` have the same exposure
    (author + every commenter) but stay fully public per Rob — lighter fix
    instead: new `toAnonSafeUser()` util nulls `profilePhotoPath` unless it's
    a preset avatar, applied only when `OptionalJwtAuthGuard` shows the caller
    is actually anonymous (logged-in callers of any role still see the real
    photo, since their cookie succeeds regardless).
  - Everywhere else already followed this pattern correctly (events list/
    detail null out attendee identities for anon/non-validated callers;
    restaurants, ratings, comments, and the leaderboard all require real
    authentication at the API level) — no other gaps found.

---

## Phase 15 — Community Points, Achievements & Leaderboard ✅ Complete

Gamification layer that rewards engagement with Bear Points, unlockable
Achievements, earnable Titles, and a community Leaderboard.

### Coordinator Role ✅ Already built

The reservation coordinator is the member who arranges the venue. Already
implemented: `reservation_assignee_id` FK on `events`, contact info fields,
confirmation token, and admin/mod assign/reassign UI on the event detail page.

### Bear Points

Points are awarded server-side only — no self-reporting. All triggers are
tied to verifiable DB records.

| Action                               | Points | Notes                                                                                                                   |
| ------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| Attend an event                      | 1      | Requires `attended = true` (Phase 10)                                                                                   |
| Be event coordinator                 | 2      | Awarded when event concludes                                                                                            |
| Coordinate at a brand-new restaurant | 4      | Restaurant never used in a prior published event — snapshot flag stored at award time so it doesn't shift retroactively |
| Successfully invite someone          | 1      | Fires when the invitee's first `attended = true` is recorded; walks invite lineage to find the original inviter         |
| Submit a restaurant rating           | 1      | One point per eligible rating                                                                                           |

- **DB**: `member_points` (id, user_id FK, point_type enum[`attendance`|`coordinator`|`coordinator_new_restaurant`|`invite`|`rating`], reference_id int, points int, awarded_at) — ledger model for auditability and corrections
- **Backfill**: attendance and ratings are retroactively calculable from existing data; coordinator and invite points require a one-time admin review script

### Achievements & Titles

Achievements are milestone unlocks. Some grant a **Title** the member can
display. Members pick their active title from all titles they've earned.

- **DB**: `achievements` (id, key varchar UNIQUE, name, description, icon varchar, title varchar NULL, is_secret tinyint, created_at)
- **DB**: `member_achievements` (id, member_id FK, achievement_id FK, earned_at; UNIQUE on member_id + achievement_id)
- **DB**: add `selected_title` varchar(100) NULL to `users` — stores the text of the chosen title
- Achievements are evaluated server-side on relevant trigger events (same hooks as points); secret achievements hidden in UI until earned
- `PATCH /api/v1/members/me/title` — member selects active title from earned list; validated server-side that they hold the achievement

**Seed achievements:**

| Key                 | Name          | Title Granted   | Trigger                                     |
| ------------------- | ------------- | --------------- | ------------------------------------------- |
| `founding_bear`     | Founding Bear | "Founding Bear" | Backfilled at launch for all active members |
| `first_dinner`      | First Dinner  | —               | First `attended = true`                     |
| `regular`           | Regular       | "Regular"       | 5 attended dinners                          |
| `veteran`           | Veteran       | "Veteran"       | 25 attended dinners                         |
| `first_coordinator` | Coordinator   | —               | First event coordinated                     |
| `scout`             | Scout         | "Scout"         | Coordinate at 3 different new restaurants   |
| `connector`         | Connector     | —               | First successful invite (invitee attends)   |
| `critic`            | Critic        | —               | Submit 5 restaurant ratings                 |

- **Founding Bear** is awarded via migration backfill at the time this phase deploys — all members with `status = 'active'` at that moment receive it; new members after deploy cannot earn it
- Profile page: earned achievements grid with icons; locked achievements shown as silhouettes (non-secret only)
- Profile page: title picker dropdown (only titles from earned achievements)
- Member's active title shown on their profile card, member list row, and leaderboard entry

### Leaderboard

Dedicated `/leaderboard` page — no auth required to view.

- Global by default; city filter dropdown (Cincinnati / Dayton / All)
- Columns: rank, avatar + display name + active title, total Bear Points, top-earning category badge
- Logged-in member's own row highlighted
- Paginated or top-50 initially

### Member List Updates

- Default sort: **alphabetical**
- Additional sort option: **Newest First** (by `created_at`)
- Points-based sort removed — leaderboard handles that use case
- **"New" badge** on member cards for accounts where `created_at >= NOW() - 14 days` — flag computed server-side in the member list API response

### Admin

- Full `member_points` ledger view per member with manual add/remove capability
- Achievement grant/revoke controls per member
- Leaderboard visible in admin with same city filter

**Definition of done:** Members earn Bear Points for attendance, coordinating, invites, and ratings. Founding Bear achievement backfilled at deploy. Achievement unlocks and title selection work end-to-end. Leaderboard is public, global by default, city-filterable. Member list has "New" badge and alphabetical/newest sort. Admin can audit and correct the points ledger and achievement grants.

---

## Phase 16 + 16c — iCal Calendar Feed & Calendar Reply RSVP ✅ Complete

Full spec: `docs/DinnerBears_iCal_Feed_Requirements.md` (REQ-NEW-16 through REQ-NEW-22)

Members subscribe to a personal iCal feed so upcoming dinners appear automatically in Apple Calendar, Google Calendar, Outlook, or any iCal-compatible app.

### Phase 16a — Subscription Feed (REQ-NEW-16 through REQ-NEW-20)

- DB: add `calendar_token VARCHAR(36) NULL UNIQUE` to `users` table
- New `CalendarModule` with `GET /api/v1/calendar/feed.ics?token=<calToken>` — no session auth; token in query param (calendar apps cannot send headers)
- Feed includes all events the member RSVPd to (going/maybe/not_going); excludes cancelled events older than 7 days
- Upgrade existing `buildIcs` in EventsService to full RFC 5545 compliance:
  - UTC datetime conversion (`YYYYMMDDTHHMMSSZ`) — current implementation uses local time, no Z suffix
  - Add missing properties: `STATUS`, `SEQUENCE`, `LAST-MODIFIED`, `URL`, `ORGANIZER`
  - Line folding at 75 octets per RFC 5545 — currently missing
- In-memory cache per token (15 min TTL); invalidate on RSVP change, event update, or token regen
- `POST /api/v1/members/me/calendar-token/regenerate` — generates new UUID, invalidates old token
- Angular account settings: **Calendar Subscription** section with copyable URL, platform setup guide (Apple/Google/Outlook), regenerate button with confirmation dialog

### Phase 16b — Email .ics Attachment (REQ-NEW-21)

- Attach a `.ics` file (`METHOD:REQUEST`) to event invitation emails
- Enables Apple Mail's native Accept / Decline / Maybe prompt
- Include `ATTENDEE;CN={name};RSVP=TRUE:mailto:{email}` in the attachment

### Phase 16c — Inbound RSVP Reply Processing (REQ-NEW-22) ✅ Complete

**Infrastructure:** Cloudflare Email Routing + Email Workers (free tier). No new Docker containers.

Setup steps (one-time, done in Cloudflare dashboard):

1. Enable Email Routing for dinnerbears.com (Cloudflare adds MX records automatically)
2. Create routes: `calendar@dinnerbears.com` → Worker (prod); `calendar-stage@dinnerbears.com` → same Worker (stage)
3. Deploy `cloudflare/email-worker.js` as the Worker; set `CLOUDFLARE_EMAIL_SECRET` env var in Worker settings
4. Set `CLOUDFLARE_EMAIL_SECRET` in API container env (same value)

**How replies flow:**

- `buildInviteAttachment()` sets `ORGANIZER:mailto:calendar@dinnerbears.com` so iOS knows where to reply
- Member RSVPs Going → RSVP confirmation email sent immediately with `.ics` (METHOD:REQUEST) attachment
- iOS Calendar shows **Accept / Maybe / Decline** buttons on the invite
- Member taps Accept → iOS sends `METHOD:REPLY` to `calendar@dinnerbears.com`
- Cloudflare Worker POSTs the raw email (JSON `{ raw }`) to `POST /api/v1/calendar/rsvp-reply`
- API validates `X-Cloudflare-Secret` header, extracts UID (→ eventId) and ATTENDEE PARTSTAT (→ RSVP status), upserts the RSVP

**UID scheme:** `dinnerbears-event-{eventId}@dinnerbears.com` — unchanged; member is identified by the ATTENDEE email in the reply.

**PARTSTAT mapping:** `ACCEPTED` → Going, `TENTATIVE` → Maybe, `DECLINED` → Not Going.

**Definition of done:** Members can subscribe to a personal iCal feed and see their events in any calendar app. Feed updates within 15 minutes of an event change or RSVP change. RFC 5545 validated. Calendar settings UI in account page. Phase 16b: invitation emails include `.ics` attachment with native prompt in Apple Mail. Phase 16c: tapping Accept/Maybe/Decline in iOS Calendar updates the member's DinnerBears RSVP automatically.

---

## Phase 17 — Event Admin Dialogs, Custom Icon Library & Hidden Achievements ✅ Complete

### Event Detail Admin Cleanup

- Share/Invite Links, Attendance, and Special Dinner Achievement management moved from always-visible inline cards into dialogs opened from an overflow (kebab) menu next to the event title; data preloads so panels aren't empty on open
- Reservation Coordinator card made visible to all members (assign/manage actions remain admin/mod only)

### Custom Icon Library

- Searchable icon picker for achievements (Material icon set + reusable custom icons)
- Admins can upload, crop, and reuse custom icon images across achievements; usage count shown per icon (icons in use can't be deleted)
- Background cleanup: uploads are scanned for white _and_ light-gray "checkerboard" pixels (some AI image generators simulate transparency this way) anywhere in the image, not just connected to the edges — fixes artifacts like a colored ring around a transparent hole
- Icons can be reprocessed in place after upload (same stored file, backgrounds re-cleaned) without needing to re-upload or touch any achievement referencing it
- Dedicated **Admin > Custom Icons** page — no longer requires opening an event's achievement editor to manage the library
- Fixed the nginx default 1MB request body limit, which was silently truncating/rejecting larger icon/photo uploads

### Hidden Achievements

- Fixed a bug where secret achievements never appeared once earned (a stale filter excluded all `is_secret` rows unconditionally) — they now display normally after being unlocked
- New hidden login-count achievements: 25/50/100/250/500 site visits, 10 Bear Points each. Visits are deduped by a time window (5 min on stage, 12 hours in production as of 2026-07-05 — was 60 min) so rapid page loads don't over-count
- 2026-07-05 fix: visit tracking moved from `JwtStrategy.validate()` (fires on every authenticated request, including background polling from a tab left open) to `AuthService.me()`, which only runs once per real app bootstrap (`APP_INITIALIZER`, i.e. a fresh page load/new tab) — a page left open in the background no longer keeps racking up visits
- New hidden **Patriotic Bear** achievement — logging in July 4–11, 2026 (America's Semiquincentennial) grants it, 10 Bear Points
- New achievement-earned splash screen: pops up automatically when a member has unseen achievements since their last visit, queues multiple if several were earned at once, and shows a red/white/blue animated fireworks celebration specifically for Patriotic Bear

### Event Invite Links Rework

- Removed the "Share on Facebook" button (it never called any DinnerBears backend — pure client-side redirect to Facebook's share dialog)
- Removed the standalone "Copy Post Text" button; its formatting logic was preserved and generalized to work per-link instead
- New event invite links are always created with a fixed 10-use cap and now expire at the event's RSVP cutoff (150 minutes before start) instead of an admin-chosen day count
- Every invite link now offers two copy actions — a plain link and a formatted "post text" version (adapted for Guest vs. Full Member, with the usage/expiry limits noted) — both embed the same token, so either one counts against the same 10-use cap

### Security Fix

- The public `/api/v1/releases` endpoint (no login required, by design) was serializing the full author `UserEntity` — including `password_hash`, email, and verification tokens — for every release, and the full submitter record for any linked feedback ticket. Now serialized down to `id`, `fullName`, `profilePhotoPath` only.

**Definition of done:** Event admin tools accessible via overflow-menu dialogs; Reservation Coordinator visible to all members. Admins can upload, crop, reuse, and clean up custom achievement icons from a dedicated admin page. Secret achievements display correctly once earned. Login-count and Patriotic Bear achievements grant automatically and surface via a queued splash screen. Event invite links use a fixed 10-use/RSVP-cutoff-expiry model with both plain and post-text copy options sharing one usage cap. Public release notes no longer leak account data.

---

## Phase 18 — Admin Nav Reorganization & Release Tooling ✅ Complete

### Admin Nav Restructure

- Desktop: the flat Admin/Moderation dropdown is now a single entry point whose menu holds **Security** (Users, Invites, Invite Tree, Audit Log), **Settings** (Email, Cities), and **Members** (Feedback, Achievements, Custom Icons, Announcements, Moderation), each opening as a nested flyout submenu via Material's `matMenuTriggerFor`-from-within-a-menu-item pattern, plus a direct **Releases** link
- Mobile sidenav mirrors the same four groupings as labeled sections (with dividers) under the existing Admin/Moderation block — no flyouts on mobile, just grouped headers
- Role gating unchanged: moderators still see Security → Users and Members → Announcements/Moderation only; Settings, the rest of Security/Members, and Releases stay admin-only

### Release Notes Tooling

- New `docs/NEXT_RELEASE.md` — a running local draft of unreleased, customer-facing notes; purely a staging file, never touches the `releases` table or the production API
- `/phase-done` now appends its customer-facing summary to `docs/NEXT_RELEASE.md`, commits it with the other phase docs, creates a local-only `phase-<N>` git tag (not pushed), and automatically builds/pushes the `stage` Docker image — `latest` (prod) is untouched
- `/release` now reads `docs/NEXT_RELEASE.md` as its starting draft, clears it back to empty once the release draft is created, and pushes only the specific `v<version>` tag (rather than `--tags`) so any unpushed local `phase-*` tags aren't swept along

**Definition of done:** Desktop admin nav is a single Admin/Moderation entry with nested Security/Settings/Members submenus and a direct Releases link; mobile sidenav mirrors the same grouping via section labels. `/phase-done` and `/release` keep `docs/NEXT_RELEASE.md` in sync automatically without reconstructing release notes from scratch at cut time, and local phase tags never leak to GitHub via a release push.

---

## Phase 19 — Admin CRUD Integration Tests ✅ Complete

### Test Harness

- New ephemeral MySQL test database (`docker/docker-compose.test.yml`), pinned to the same MySQL version as the real Unraid instance (9.7) rather than a lighter substitute like SQLite — entities use MySQL-specific column types (`json`, `enum`, `longtext`, `unsigned` PKs) that don't map cleanly elsewhere, and `synchronize: false` is a hard project rule
- `api/test/utils/test-app.ts` boots the real `AppModule` end to end — real guards, real DB, real migrations via the existing `migrationsRun: true` — not a trimmed test-only module
- `api/test/utils/seed.ts` seeds cities/restaurants/users and mints real login sessions (via `AuthService.issueTokens`, not a hand-crafted JWT) so `JwtStrategy`'s session-table check passes like a real login would
- `bash scripts/run-e2e-tests.sh` — one command: starts the test DB, runs the full suite, always tears down

### CRUD Coverage

Real-HTTP integration tests (success paths, validation errors, and 401/403 role-guard enforcement) for 11 admin resources: Events, Restaurants, Announcements, Cities, Releases, Achievements, Custom Icons, Event Comments, admin User management (list/ban/unban/role-change/delete), Feedback, and Reports. 202 tests total.

### Pre-Existing Migration Bugs Fixed

Bootstrapping a genuinely fresh database (never done before this phase — every real environment was already migrated) surfaced two latent bugs, both invisible in practice since already-migrated environments never re-run a migration once it's recorded as applied:

- `1749000008000-AddRestaurantAuditFields` used `ADD COLUMN IF NOT EXISTS`, which real MySQL doesn't support at any version (confirmed empirically against both 8.0.46 and 9.7.1 — it's a MariaDB-only extension). Rewritten to check `information_schema.COLUMNS` first.
- `1749000014000-CreateEmailSystem` unconditionally recreated `email_suppressions`, which `CreateUsers` already creates. Same fix pattern.

**Definition of done:** `bash scripts/run-e2e-tests.sh` runs the full migration history and 202-test suite cleanly against a database matching production's exact MySQL version, starting from nothing.

---

## Phase 20 — Cross-Cutting E2E Test Coverage ✅ Complete

Extends the Phase 19 harness to flows that don't fit inside a single CRUD resource. Added 267 new tests across 6 spec files (469 total, up from 202), all passing via `bash scripts/run-e2e-tests.sh` against a fresh database.

- **Batch 4 — Identity & Access** (`auth.e2e-spec.ts`, `invites.e2e-spec.ts`, `account-lifecycle.e2e-spec.ts`, 97 tests): auth/OAuth login flows (including a mocked Facebook Graph API and HMAC-verified Meta data-deletion callback), invites (create/redeem/revoke/lineage/expiration), account lifecycle (self-delete, Facebook data-deletion callback, hard-delete cron)
- **Batch 5 — Event Engagement & Gamification** (`rsvp.e2e-spec.ts`, `gamification.e2e-spec.ts`, 92 tests): RSVP lifecycle (create/update/remove, cutoff enforcement, member-generated and public guest links, attendance, walk-ins), achievement auto-granting triggers for every tier, leaderboard/points ledger aggregation
- **Batch 6 — Content Delivery** (`uploads.e2e-spec.ts`, `email-push.e2e-spec.ts`, `calendar.e2e-spec.ts`, 78 tests): restaurant/profile/achievement/custom-icon photo uploads and auth-gated serving, email queue dispatch and Brevo webhook handling, push subscription and in-app notifications, calendar ICS feed generation (RFC 5545 checks) and inbound RSVP-reply processing

### Test Harness Additions
- `resetThrottler(app)` (`api/test/utils/test-app.ts`) clears `ThrottlerStorage` (and its pending timers) between tests — auth/calendar routes carry tight per-route `@Throttle` limits, and a single app instance is reused across every test in a spec file
- `hashPassword()` (`api/test/utils/seed.ts`) — shared bcrypt helper for specs that need a real password hash on a seeded user
- Discovered that `truncateAllTables` also wipes migration-seeded reference data (e.g. the achievement catalog) — existing specs never depended on it staying seeded, so `gamification.e2e-spec.ts` re-seeds the specific achievement rows it needs locally rather than changing the shared harness (which `achievements.e2e-spec.ts`'s CRUD tests rely on being wiped between tests)

### Pre-Existing Bugs Fixed
Real-HTTP testing against actual business logic (not mocks) surfaced four latent defects, none previously caught because nothing had exercised these code paths end-to-end:
- `PointsService.checkInvitePointForInviter` destructured a raw-query result key (`u_invited_by`) that never matched what the query actually returned (`invited_by`, since the query selected without an explicit `AS` alias) — the "successful invite" Bear Point and `connector` achievement have never fired in production. Fixed using the same explicit-alias pattern already used in `admin.service.ts`.
- `EmailService.checkNotificationPref` compared a `tinyint` column value against the literal `false` (`!== false`) — since generic `tinyint` columns come back from the DB driver as `0`/`1`, not `boolean`, the strict comparison was always `true`, silently defeating every per-template email-preference opt-out. Fixed to compare numerically.
- `SubscribePushDto.keys` relied on `@ValidateNested()` alone to require the field, which class-validator does not enforce for `undefined` — an omitted `keys` object crashed the controller with a 500 instead of failing validation with a 400. Added `@IsDefined()`.
- `CalendarService.extractIcalFromEmail` applied full quoted-printable decoding (`=XY` hex-escape resolution) even to already-readable, non-encoded iCal text. Since `X` and `Y` matching any two hex digits triggers a decode, `PARTSTAT=ACCEPTED` (`=AC`) and `PARTSTAT=DECLINED` (`=DE`) were silently corrupted while `PARTSTAT=TENTATIVE` (`=TE`, not hex) happened to survive — meaning real Accept/Decline replies from iOS Calendar could silently fail to update a member's RSVP. Fixed to only strip QP soft-line-breaks on the already-matched branch, reserving full hex-escape decoding for the fallback branch where the iCal block genuinely needs it to be found at all.

**Definition of done:** `bash scripts/run-e2e-tests.sh` runs the full migration history and 469-test suite cleanly against a database matching production's exact MySQL version, starting from nothing. All three batches covered; four real production bugs found via genuine e2e testing and fixed in the same pass.

## Phase 21 — Edge Case & Injection Tests ✅ Complete

Scoped from the two backlog bullets below via two research passes: a raw-SQL/
`createQueryBuilder` audit (clean — every query already parameterized) and a
DTO field-limit inventory (0% edge-case coverage existed; ~13 real validation
gaps found beyond missing tests). Rob chose fix + test, not test-only.

### Fixed validation gaps

- Converted 8 endpoints that took `@Body()` as an inline object-literal type
  (silently skipping the global `ValidationPipe` entirely — a violation of
  `api/CLAUDE.md`'s "DTOs with class-validator for all request bodies" rule)
  to real DTO classes: `community.controller.ts`'s title-select, achievement
  grant, event-achievement create, achievement create/update, and custom-icon
  create; `admin.controller.ts`'s role-change and email-config update
- Added missing `@MaxLength` where a DTO field had no cap despite a real
  `varchar` column limit behind it (previously an oversized value 500'd at
  the DB instead of 400ing at validation): auth email fields, invite
  `boundToEmail`, restaurant/merch `websiteUrl`/`storeUrl`, release
  `version`, push subscription `p256dh`/`auth`
- `announcement.body` brought in line with `feedback.body`/`release.body` —
  added a `@MaxLength(50000)` cap and routed it through the same
  `sanitize-html` call on create/update

### New test coverage

- `api/test/edge-cases.e2e-spec.ts` (38 tests): boundary tests (limit,
  limit+1) across cities, restaurants, feedback, releases, invites,
  announcements, events, event comments, restaurant ratings, merch config,
  and push subscriptions, including the RSVP `guestNames` compound case
  (`@ArrayMaxSize(9)` + per-item `@MaxLength(200)`); regression tests
  proving each newly-converted no-DTO endpoint now rejects invalid/oversized
  input; HTML-injection tests confirming sanitized fields (feedback,
  announcements) strip `<script>` tags and unsanitized fields (event
  comments) round-trip as inert literal text; SQL-injection-shaped payload
  tests against restaurant create, the admin audit log's `LIKE` search, and
  the raw parameterized `DELETE` in the account self-delete cleanup path —
  all treated as inert data, no errors, no data loss

**Definition of done:** `bash scripts/run-e2e-tests.sh` runs the full
migration history and 511-test suite (up from 469) cleanly against a fresh
database. All ~13 validation gaps found during scoping fixed in the same
pass; zero raw-SQL parameterization issues found (audit-only, no fix
needed).

---

## Phase 22 — Rate Limiting Audit & Hardening ✅ Complete

Target policy: 30 req/min/IP for write operations (create/update/delete),
60 req/min/IP for reads. Scoped via an Explore-agent audit of the existing
`@nestjs/throttler` setup, which found the global default (60/min) already
matched the read target but every write route without its own `@Throttle`
was 2x looser than intended — systemic across all 24 controllers, not a few
one-offs. Rob chose per-IP keying (not per-user) as the simpler, lower-risk
option for a small invite-only app, and chose to fix a webhook auth gap
found during scoping in the same pass.

### Mechanism

- `ThrottlerAuditGuard` (`api/src/common/guards/throttler-audit.guard.ts`,
  already the app's sole `APP_GUARD`) gained a `handleRequest` override: for
  any mutating request (not GET/HEAD/OPTIONS) that would otherwise fall
  through to the module-level default, it substitutes a 30/min ceiling
  before delegating to the base `ThrottlerGuard`. Routes with their own
  `@Throttle()` are detected by comparing the resolved limit against the
  configured global default and are left untouched — this fixed every
  previously-unprotected write route in one ~15-line change instead of ~80
  individual decorator edits, and doesn't disturb the 7 routes (login,
  register, password reset/forgot, resend-verification, calendar feed) that
  already had tighter explicit limits.
- Bespoke tighter `@Throttle` overrides added to 10 higher-risk routes
  regardless of the general policy: the unauthenticated public writes
  (`events/:id/public-rsvp`, `events/guest-link/:token` POST+DELETE,
  `events/reservation-confirm/:token`) at 10/min; expensive bulk/admin
  operations (`restaurants/enrich/bulk`, `admin/achievements/backfill-founders`,
  `backfill-invites`, `recalculate-points`) at 5/min; privilege escalation
  (`admin/users/:id/role`) at 10/min; the paid-API-proxying
  `restaurants/place-search` at 20/min; and the Brevo webhook (see below)
  at 120/min.

### Webhook auth fix

`POST /email/webhook/brevo` had no signature/secret verification at all —
anyone who discovered the URL could forge delivery/bounce/unsubscribe/spam
events for any member's email. Added a `BREVO_WEBHOOK_SECRET` shared-secret
check via query param (mirroring `calendar.controller.ts`'s existing
`CLOUDFLARE_EMAIL_SECRET` pattern for the sibling inbound-email webhook,
since Brevo's dashboard only lets you configure a URL, not custom headers).
**Follow-up needed from Rob:** `.env.example` is outside this session's
write permissions — add `BREVO_WEBHOOK_SECRET=` there next to
`CLOUDFLARE_EMAIL_SECRET`, set a real value in stage/prod `.env`, and update
the registered webhook URL in Brevo's dashboard to
`.../email/webhook/brevo?secret=<value>`.

### Tests

New `api/test/rate-limiting.e2e-spec.ts` (11 tests): the generic write
default firing at request 31 on a route with no prior throttle; the generic
read default still allowing 60/min; a regression check that `/auth/register`
still throttles at its own 5/min (not clobbered by the new default); each of
the 10 bespoke routes enforcing its specific limit; and the Brevo webhook
rejecting missing/wrong secrets with 401 while accepting the correct one.
Updated the 6 pre-existing Brevo webhook tests in `email-push.e2e-spec.ts`
to pass the new required secret.

**Definition of done:** `bash scripts/run-e2e-tests.sh` runs the full
migration history and 527-test suite (up from 516) cleanly. Every write
route across all 24 controllers is throttled at 30/min or a documented
tighter bespoke limit, without regressing the 7 pre-existing explicit
throttles or any read route. The Brevo webhook requires a valid shared
secret.

## Phase 23 — Security Audit ✅ Complete

Turned into a reusable `/security-audit` command (`.claude/commands/security-audit.md`)
adapting a generic 20-point checklist to this stack (NestJS/MySQL/JWT cookies,
self-hosted behind NGINX Proxy Manager, not Next.js/Vercel). Run via an
Explore-agent audit against the real codebase, not from memory of what prior
phases claimed.

**Result:** 16 of 20 items already passed (password hashing, httpOnly
cookies, JWT secret handling, password-reset expiry/single-use, HTML
sanitization, upload validation, global `ValidationPipe` whitelisting, IDOR
scoping, parameterized queries, response serialization, admin role guards,
hard-delete anonymization, `.gitignore`, no hardcoded secrets, and CORS —
same-origin via one nginx container, no `enableCors` needed).

**Fixed:**
- Login endpoint was throttled at 10/min, not the required 5/min or tighter
  — tightened to `@Throttle({ default: { limit: 5, ttl: 60000 } })`
  (`api/src/modules/auth/auth.controller.ts`)
- `PATCH /users/me/notification-prefs` took a raw `@Body() body: Record<string, boolean>`,
  bypassing the global `ValidationPipe` entirely, then `Object.assign`'d it
  directly onto the TypeORM entity before `save()` — including the
  writable, unique `id`/`user_id` columns. A crafted body (e.g.
  `{"id": <another member's preferences row PK>}`) would cause TypeORM's
  `save()` to update someone else's row instead of the caller's own (IDOR
  via mass assignment). Fixed with a real `UpdateNotificationPrefsDto`
  (`api/src/modules/users/dto/update-notification-prefs.dto.ts`, one
  `@IsOptional() @IsBoolean()` per toggle) and an explicit
  `NOTIFICATION_PREF_FIELDS` whitelist loop in
  `EmailService.updateNotificationPrefs` (`api/src/modules/email/email.service.ts`)
  instead of blind `Object.assign`

**Found, not fixed (logged to Post-Launch Backlog):**
- `npm audit` on `frontend/` shows 3 real high-severity runtime
  vulnerabilities (`@angular/core` DOM clobbering/cache poisoning,
  `@angular/service-worker` cross-origin header leakage, `quill` XSS via
  HTML export) — none have a non-breaking fix; all three require jumping
  Angular from 19 to 22 (a 3-major-version upgrade), and quill has no
  patched version published yet at all. `api/`'s `npm audit` is clean.
- No HSTS header on the nginx config — reviewed with Rob, deliberately
  skipped for now given the lock-in risk if HTTPS/cert renewal ever breaks
  at the NGINX Proxy Manager layer (browsers would refuse HTTP fallback for
  the `max-age` duration). Left as a known, accepted gap.

**Definition of done:** All 20 checklist items evaluated against the actual
codebase with file:line evidence, not assumed from prior phase notes. Every
FAIL fixed except the two logged above, which are deliberate scope/risk
calls made with Rob rather than oversights. Full 527-test e2e suite passes
after the fixes. `/security-audit` command exists for repeat runs.

## Phase 24 — Dead Code & Duplication Cleanup ✅ Complete

Scoped 2026-07-12 alongside the Phase 23 audit, executed the same day. Two
independent sub-tasks, since no single tool covers both.

### Sub-task A — Unused code (tool-assisted)

Added `knip.json` to both workspaces (`entry`/`project` config for
migrations, one-off scripts, and `test/*.e2e-spec.ts`, which knip
misreads as unused without it) and ran `npx knip`, cross-checking every
finding against a plain grep before touching anything — knip's static
graph doesn't see string/DB-value comparisons, so several flagged enum
members (`InviteType.GUEST_RSVP`, `InviteType.SHAREABLE_RSVP`,
`ReviewAction.DISMISS`) were confirmed live and deliberately left alone.
Also ran `eslint` (catches unused imports/vars/params that knip's
export-level scan doesn't) and a full `ng build --configuration
production` (Angular's AOT compiler resolves every template binding,
which caught two unused-import cases neither knip nor eslint saw:
`RouterLink` in both legal pages).

**Removed:**
- `api/src/modules/email/gmail.service.ts` — already an empty stub
  ("Replaced by ResendService") confirming its own deprecation; deleted
  with Rob's sign-off
- `api/src/database/entities/app-config.entity.ts` — unused TypeORM
  entity for an `app_config` table seeded at launch with values (invite
  expiry hours, max guests, inactivity thresholds) that turned out to be
  hardcoded elsewhere in the app instead of ever being read from this
  table. Entity deleted; the DB table/migration were deliberately left
  alone per Rob (not worth a schema change) — it remains available if
  admin-configurable settings are ever built
- `api/src/scripts/import-restaurants.ts` (whole directory) — the Phase
  3.5 one-time historical-import script, removed per Rob rather than
  fixed: it required the `xlsx` package, which isn't installed and whose
  only npm-published version (0.18.5) has unpatched prototype-pollution/
  ReDoS advisories (SheetJS ships the real fix only via their own CDN)
- `api/src/README.ts`, `frontend/src/app/README.ts` — leftover `nest
  new`/`ng new` scaffolding comments
- `frontend/src/app/features/feedback/feedback-submit.component.ts` —
  orphaned; `/feedback/new` loads `feedback-new.component.ts` instead
- 9 stray 0-byte files at the repo root (`=`, `CACHED`, `CANCELED`,
  `[build`, `[internal]`, `[stage-1`, `exporting`, `naming`,
  `transferring`) — fragments of a Docker BuildKit log accidentally
  committed as files back in Phase 1 (2026-06-04), never referenced
  anywhere
- ~20 files' worth of unused imports/exports/constructor-injected
  dependencies/function params across both workspaces (e.g. an
  `EmailDispatcherService` import of `EmailStatus`, unused `rsvpRepo`/
  `inviteRepo` injections in `PointsService`, an unused `res` param on
  `AuthController.register`, a dead `TEMPLATE_ENV_KEYS` export in
  `email.constants.ts` that duplicated a private map already used in
  `brevo.service.ts`)
- `api/eslint.config.js`: added `argsIgnorePattern`/`varsIgnorePattern:
  '^_'` to `no-unused-vars` so the codebase's existing underscore-prefix
  convention (used for required-but-unused migration `down()` params)
  is actually recognized instead of silently relying on rule positional
  quirks

**Dependency hygiene** (`api/package.json`): removed 4 genuinely unused
devDependencies (`@typescript-eslint/eslint-plugin`, `@typescript-eslint/
parser`, `eslint-plugin-prettier`, `source-map-support`); added 5
packages that were used directly in source but only ever pulled in
transitively (`express`, `dotenv`, `ms`, `multer`, `@eslint/js`) — a
latent fragility, since a version bump anywhere upstream could have
silently broken a `require()` that wasn't guaranteed by anything in
`package.json`. `frontend/package.json`: removed unused
`@angular/platform-browser-dynamic` (app uses `bootstrapApplication`,
not the older `platformBrowserDynamic` bootstrap).

### Sub-task B — Duplicate functions/components across files

Delegated the broad read-through to an Explore agent (semantic
similarity isn't tool-assisted), then personally verified and acted on
its findings:

- **`formatTime()`/`initials()`** were copy-pasted (near byte-identical)
  across 5 Angular components and 2 components respectively — extracted
  to `frontend/src/app/shared/utils/format-event.ts`; each component's
  method now delegates to the shared function so no template changed
- **RFC 5545 ICS-generation logic** — Eastern→UTC time conversion,
  75-octet line-folding, and TEXT-value escaping — was independently
  reimplemented in `events.service.ts`'s `buildIcs()` instead of reusing
  `calendar.service.ts`'s private versions (which itself had the escape
  function duplicated twice internally). Extracted to
  `api/src/common/utils/ics.util.ts` (`icsEscape`, `eventTimeToUtc`,
  `toIcsUtcString`, `foldIcsLine`); both services now import the same
  functions. Highest-risk change of the phase (compliance-sensitive,
  78 calendar-related tests) — verified with a full e2e run immediately
  after, no drift
- 9 more inline copies of the same time-formatting expression within
  `events.service.ts` itself (across different `send*Email` methods)
  consolidated into one private `formatEventTimeDisplay()` helper
- Checked and ruled out: `role === UserRole.ADMIN || role === UserRole.
  MODERATOR` appears ~15+ times across services/controllers, but each
  instance is a distinct authorization decision using a shared enum —
  a reused idiom, not duplicated logic, so left as-is

### Execution safety

Followed the batch-and-verify discipline throughout: full `bash
scripts/run-e2e-tests.sh` (527/527) after the dependency-hygiene batch,
after Sub-task A's source edits, and again after the ICS consolidation.
`frontend/` has no automated test coverage, so changes there were
verified via `ng build --configuration production` (full AOT template
compilation) plus a live `ng serve` + Playwright smoke-check of every
page reachable without a running backend (home, `/privacy`, `/terms`);
authenticated pages weren't reachable in the working environment (no
local API/DB session available), so those relied on the AOT build
catching any broken template binding — which it does, by construction.

**Definition of done:** Sub-task A's findings reviewed and cross-checked
before any deletion, genuine dead code removed in verified batches with
zero test regressions. Sub-task B's duplicate-code report acted on with
the same discipline, including the highest-risk cross-service ICS
consolidation. Full 527-test e2e suite green throughout; frontend
verified via production build + reachable-page smoke test.

---

## Phase 25 — Mobile UI Bug Fixes ✅ Complete

Reported by Rob from live mobile use (iPhone screenshots, stage environment),
2026-07-18. First phase developed on its own branch
(`phase-25-mobile-ui-bug-fixes`) under the new branch-per-phase workflow —
see CLAUDE.md "Branching Workflow".

- **Restaurants list header overflow** — `.page-header`/`.header-actions` in
  `restaurants-list.component.ts` have no `flex-wrap`, unlike the filters row
  below them which does. On narrow viewports the button row (Archived /
  Import / Enrich All / Add Restaurant, depending on role) overflows
  horizontally instead of wrapping, pushing later buttons off-screen.
- **Create Event dialog wider than viewport** — `EventFormDialogComponent`'s
  `.event-form` has a hardcoded `min-width: 480px`, and all three call sites
  (`events-list`, `event-detail`, `restaurant-detail`) open it with a fixed
  `width: '600px'` and no `maxWidth` clamp — unlike
  `RestaurantFormDialogComponent`, which already uses `maxWidth: '95vw'`.
  Fields clip on both edges on mobile.
- **Attendance "Add Walk-in" doesn't scroll into view** — the walk-in form
  is a plain conditional block toggled by a signal, with no
  `scrollIntoView()`/`ViewChild` wiring, so revealing it doesn't bring it
  on-screen.
- **Walk-in search results can be clipped** — the results list scrolls
  within `mat-dialog-content`, but nothing keeps it visible above the
  dialog's fixed `mat-dialog-actions` footer as the attendee list + walk-in
  form + results grow taller than the dialog.
- **Walk-in search doesn't exclude existing attendees** — backend
  `EventsService.searchMembersForWalkin()` accepts `eventId` but never uses
  it in the query; it only filters on `status = 'active'` and the name
  match, so members already on the attendance/RSVP list still show up as
  walk-in candidates.

### Verification

Verified against a fully disposable local stack rather than stage/prod: a
throwaway MySQL container (migrations run, seeded with a fake city,
restaurant, event, and RSVPs — including a "Bill DeMange/Brocker/Perkins"
set mirroring Rob's real screenshots to test the exclusion fix
specifically), a locally-patched API pointed at it, and `ng serve` proxying
to that API. Authenticated via the seeded `automation@dinnerbears.internal`
account (temporarily promoted to admin in the disposable DB only). All 5
fixes confirmed via mobile-viewport (390×844) Playwright screenshots; no
"Add"/save actions were taken on real data. Full e2e suite green (527/527
— one `event-comments.e2e-spec` `beforeEach` timeout during the run was
resource contention from the parallel local verification stack, confirmed
by rerunning that spec alone clean). All scratch files (local `api/.env`,
proxy config, disposable container) removed after verification.

**Definition of done:** all 5 bugs fixed and verified on a mobile viewport,
existing e2e suite still green. Not yet merged into `main` — Rob deferred
`/release` to keep working; will merge via PR whenever `/release` runs.

---

## Phase 26 — Login Splash, Pending Invites in Admin, Horizontal Scroll Bug ✅ Complete

Scoped 2026-07-18. Branched off `phase-25-mobile-ui-bug-fixes` (not `main`)
since Phase 25 hadn't been released yet — see CLAUDE.md "Branching
Workflow" and "Current Development Phase".

- **Post-login splash screen ✅** — on login, show a splash surfacing what's
  new since the member's last login. Confirmed spec (2026-07-18, see memory
  `project-phase26-login-splash-spec`):
  - Releases: latest unseen release only (max 1, never a backlog).
  - Announcements: latest unseen announcement only (max 1, never a
    backlog).
  - Achievements: all unseen/newly-earned achievements since last login,
    uncapped — reuses the existing achievement-splash reveal system from
    Phase 20/21 (`member_achievements.seen_at`) rather than a new parallel
    mechanism.
  - Shows once per login; marked seen as soon as displayed (no explicit
    dismiss click required for the seen state).
  - Only surfaces items newer than the member's last login, so existing
    members aren't flooded with all past history on ship day.
  - Implemented by generalizing `AchievementSplashComponent`/`Service` into
    `SplashComponent`/`SplashService`; new `users.last_seen_release_id`/
    `last_seen_announcement_id` columns (migration backfills existing users
    to today's latest of each); new `WhatsNewService` +
    `members/me/whats-new` endpoints in `CommunityModule`. Verified via
    migration up()/down() against a real disposable DB and a full
    Playwright walkthrough (queue → dismiss → seen-state persists across
    reload; confirmed two simultaneously-unseen releases only ever surface
    the newer one).
- **Pending invites missing from admin Users list ✅** — `AdminService.
  getUsers()` now merges in unaccepted single-use "member" invites as
  synthetic rows (`isPendingInvite: true`, negative id to avoid colliding
  with real user ids), shown with a distinct "Pending Invite" chip in
  `admin-users.component.ts`. Read-only for this pass — no revoke/resend
  action wired up from this view yet (possible follow-up if Rob wants it).
  Verified: 29/29 `admin-users.e2e-spec.ts` tests green in isolation.
- **Horizontal scroll bug on mobile — resolved without a code change ✅** —
  Rob confirmed on 2026-07-19 that scrolling left on a phone no longer
  shifts the whole page and reveals white space; it self-resolved,
  most likely as a side effect of Phase 25's restaurants-list header
  `flex-wrap` fix (that row was the kind of always-present, viewport-width
  element whose overflow could have been causing page-level horizontal
  scroll site-wide). No dedicated fix needed; no screenshot was ultimately
  required.

**Definition of done:** all 3 items resolved and verified. Not yet merged
into `main` — will merge via PR whenever `/release` runs (may ride
together with Phase 25's unreleased fixes).

---

## Phase 27 — Angular 19→22 Upgrade & Points Audit Trail ✅ Complete

Started 2026-07-19 once phases 25/26 had actually merged to `main` via
`/release` (confirmed live on stage + prod as v1.4.3). Branched as
`phase-27-angular-19-22-upgrade` off the fresh `main`. Scope grew
considerably beyond the original upgrade as Rob tested the result live on
stage and follow-on requests landed on the same branch.

### Angular 19 → 22 upgrade
- Sequential major hops (19→20→21→22) via `ng update`, verified with a full
  build after each. TypeScript bumped 5.6→6.0 along the way (removed the
  now-deprecated, actually-unused `baseUrl` tsconfig option that TS 6.0
  turns into a hard error).
- `ngx-quill` bumped in lockstep each hop (27→28→30→31) to stay peer-compatible
  with each Angular major.
- Root Dockerfile's frontend-build stage and `frontend/Dockerfile` pinned to
  `node:22-alpine` (was a floating `node:20-alpine`, which wouldn't have
  reliably cleared Angular 22's Node floor).
- Migrated the last 3 non-standalone-syntax components (`event-card`,
  `error-page`, `icon-picker`) off `@Input`/`@Output` decorators onto signal
  `input()`/`output()`; `app.config.ts`'s `APP_INITIALIZER` provider onto
  `provideAppInitializer()`; the `serve` target off the deprecated webpack
  dev-server onto `@angular/build`'s esbuild-native one.
- Angular 22's own migration schematics applied `ChangeDetectionStrategy.Eager`
  to all ~73 existing components (preserving pre-v22 default change-detection
  behavior against the new default) and `withXhr()` to `provideHttpClient()`
  (preserving the XHR backend against the new default fetch backend) —
  automated, not manual, and deliberately *not* an OnPush migration (that's
  real behavior change, scoped out of a version-bump phase); disabled
  angular-eslint's new `prefer-on-push-component-change-detection` rule
  accordingly rather than fighting it file-by-file.
- **All 3 flagged `npm audit` vulnerabilities closed**: `@angular/core` and
  `@angular/service-worker` by the version bump itself; `quill`'s XSS-via-
  HTML-export pinned to exact `2.0.2` (the `^2.0.3` range's resolved version
  has an unpatched regression 2.0.2 doesn't; no 2.0.4+ exists upstream).
- Verified via build + lint + a full Playwright click-through on stage
  (home, 404, event RSVP, admin restaurant add/delete, admin achievement
  icon-picker) using the `automation@dinnerbears.internal` account —
  zero unexpected console errors.
- `frontend/src/**/*.spec.ts`: still zero files, confirmed again this phase.
  Flagged to Rob as a bigger, separate undertaking (no existing harness/
  TestBed patterns to build on) rather than silently skipped or scope-crept
  into this phase.

### Bug fixes found via live stage testing
- **Automation account couldn't be flipped back down from admin** —
  `AdminService.setRole()` blocked *any* role change on a user currently at
  `ADMIN`, with no exception for the documented automation-account
  flip-up-for-testing/flip-back-down workflow. Backend guard fixed (exempt
  the automation account, matched by email); a second, independent bug in
  `member-profile.component.ts` also hid the role-selector UI entirely
  whenever `role === 'admin'` even though its own `mat-option`s already
  anticipated flipping an automation account back down — fixed to match.
  Regression test added retroactively (wasn't covered when first fixed).
- **Admin achievements page header overflow on mobile** — `.page-header`
  had no `flex-wrap`, so the 3 action buttons (Re-run Founder Check /
  Recalculate Points / Backfill Invite Points) compressed into cramped
  multi-line pills and overflowed off-screen instead of wrapping as whole
  buttons. Same class of bug as Phase 25's restaurants-list header fix.

### Points audit trail (new, requested mid-phase)
- New self/admin/moderator-accessible `GET /members/:id/points/ledger`,
  distinct from the pre-existing admin-only raw ledger endpoint (left
  untouched, still used by the separate admin point-management tool).
  Returns a human-labeled itemized breakdown (date, description, points)
  plus a total that reconciles with the profile page's existing points
  badge by construction (same underlying `member_points` rows).
- Clicking the "paw badge" points total on a member's profile (self, or
  admin/moderator on someone else's) now opens a dialog listing that
  breakdown, modeled on the existing `AttendanceDialogComponent` pattern.
- Founding Bear achievement bumped from 1 point to 20 — it's a one-time,
  can-never-be-re-earned achievement and should feel special relative to
  the rest of the catalog.

### Data-integrity bugs surfaced by building the audit trail
Live-testing the new audit list on stage surfaced two real, pre-existing
data bugs, both fixed with migrations rather than one-off scripts:
- `ResetAndBackfillAchievements` (an earlier phase's historical backfill)
  had inserted the Founding Bear bonus point via raw SQL with
  `reference_id` hardcoded `NULL` — the one place in the codebase where an
  achievement-type `member_points` row wasn't traceable back to its
  achievement. Backfilled to the real id.
- That NULL `reference_id` window, combined with `adminRecalculatePoints()`
  ("Recalculate Points" in the admin UI)'s duplicate-row check being keyed
  on `reference_id` equality, meant a NULL row was invisible to that check
  — so a "Recalculate Points" click during this window inserted a *second*
  points row per already-credited member instead of finding the existing
  one. Cleaned up (de-dupe migration, keeping the earliest row per
  user+achievement), then hardened at the schema level so this class of
  bug can't recur: `member_points.reference_id` is now `NOT NULL` (every
  real award path already always supplied one) plus a
  `UNIQUE (user_id, point_type, reference_id)` constraint, mirroring
  `member_achievements`'s existing `uq_member_achievement`.
  `adminRecalculatePoints()`'s insert also switched to `INSERT IGNORE` as
  defense-in-depth against the new constraint. Regression test added
  (recalculate-points run twice no longer risks a duplicate).

### Verification
Backend: full `api/` e2e suite (21 suites, 535 tests) run against a
throwaway MySQL container after every backend-affecting commit, all green.
Frontend: `ng build` + `eslint` clean after every commit (same pre-existing
~50-error accessibility/`any`-type lint debt throughout, none of it new).
Every change deployed to and manually verified on `stage.dinnerbears.com`
before moving to the next one — 9 separate stage pushes across the phase,
each following a green local verification pass.

**Definition of done:** Angular 22 live and verified on stage, all 3
`npm audit` items closed, points audit trail shipped and its follow-on data
bugs fixed. Not yet merged into `main` — will merge via PR at the next
`/release`.

## Phase 28 — Retroactive Event-Achievement Sync ✅ Complete

Started 2026-07-20, scoped ad hoc mid-conversation: an admin investigation
into a member's out-of-order-looking "Bear Points History" entries surfaced
that neither toggling an event's secret-dinner flag nor creating/deleting
its one-off "Special Dinner Achievement" ever touched points or badges for
members already marked attended at that event — those only applied to
future attendance. Branched as `phase-28-retroactive-event-achievements`.

### Retroactive award/removal, scoped per event
- `PointsService.resyncSecretDinnerForEvent(eventId, isSecret)`: flipping
  an event's secret-dinner flag on walks that event's `attended = true`
  RSVPs and awards `secret_dinner` points to anyone missing one (idempotent,
  reuses the existing per-user dedupe check); flipping it off deletes every
  `secret_dinner` point row tied to that event and re-checks each affected
  member's achievement tier.
- `AchievementsService.recheckSecretDinnerAchievements(userId)`: the
  downward counterpart to the existing `checkSecretDinnerAchievements` —
  revokes a tier's badge + points once a member's count drops below its
  threshold, so a badge (e.g. "Secret Society") never outlives the count
  it was earned from.
- `AchievementsService.grantEventAchievementToAttendees(eventId)`: called
  right after a Special Dinner Achievement is created, grants it to every
  already-attended member instead of only whoever attends from then on.
- `AchievementsService.deleteEventAchievement(eventId)` (net new — no
  delete endpoint or UI button existed before this phase): removes the
  achievement definition itself plus every member's badge and points for
  it. `DELETE admin/events/:eventId/achievement` + a "Remove Achievement"
  button added to the event's achievement admin dialog.
- All of the above are scoped to a single event's attendee list (not a
  global sweep), so cost stays flat regardless of how many events
  accumulate over time — unlike the existing global
  `adminRecalculatePoints()` ("Recalculate Points" in the admin UI), which
  was deliberately left alone rather than overloaded with removal semantics
  it was never designed for.
- `EventsService.update()` now detects an actual `is_secret` change and
  runs the resync inline, returning the result (`{ enabled, awarded }` or
  `{ enabled, removed }`) on the response; the admin event-edit dialog and
  the achievement dialog surface it via snackbar (e.g. "awarded 2
  already-attended members").

### Verification
New `event-achievement-resync.e2e-spec.ts` (7 tests) covers all four
flows: secret-dinner-on award, secret-dinner-off removal + tier revoke,
achievement-create retroactive grant, achievement-delete clawback, plus
role-guard and no-op-change cases. Full `api/` e2e suite (22 suites, 542
tests) green against a throwaway MySQL container (one unrelated
`feedback.e2e-spec.ts` timeout in the full run confirmed as a flake by an
isolated re-run). Frontend `ng build` + `eslint` clean. No schema changes
this phase — pure application logic on the existing `member_points` /
`member_achievements` / `achievements` tables.

**Definition of done:** merged into `main`, live on stage
(`rtippenhauer/dinnerbears:stage`) — awaiting the next `/release` to reach
prod. One-time manual cleanup still needed on the specific event that
prompted this (toggle secret-dinner off→on→off, and delete+recreate its
Special Dinner Achievement) to catch up its already-stale totals, now that
the sync logic exists to do it correctly.

---

## Phase 29 — White-Label Template for a New Group

Started 2026-07-21. Rob wants to stand up a second, separately-branded
community dining site for a different group (Southwest Ohio) — a fork of
this codebase with its own domain, database, secrets, and branding, not
another city inside DinnerBears itself. The new site is single-region —
no multi-city subdomain switching needed. Branched as
`phase-29-white-label-template`.

Scope:
- Extract hardcoded branding into a single theme/config point: app name,
  tagline, primary/accent/background colors, logo + splash images,
  favicon/PWA icons
- Replace DinnerBears-specific legal copy (Terms, Privacy, About/story
  page) with clearly-marked placeholder content a new operator must fill
  in
- Fix `CityService.currentCity` (`frontend/src/app/core/services/city.service.ts`)
  to fall back to the sole active city when there's no subdomain match
  (root-domain deployments), instead of requiring subdomain routing
- Simplify/hide the city-selector nav dropdown when only one city exists
- Bootstrap script or seed migration: creates the one city row,
  `app_config` row, `email_provider_config` row, and first admin user for
  a fresh database
- New `docs/NEW_INSTANCE_SETUP.md`: step-by-step for a new operator —
  their own Google OAuth app, Facebook app (Go-Live checklist), Brevo/Resend
  account, VAPID keypair generation, Docker Compose stack, MySQL instance,
  domain/DNS, `.env` checklist
- Audit for any remaining hardcoded `dinnerbears.com` assumptions in the
  API (redirect URIs, CORS origins, email templates, `APP_URL` usage) and
  parameterize them

**Definition of done:** A second operator can clone the repo, follow
`docs/NEW_INSTANCE_SETUP.md` top to bottom with their own
domain/branding/secrets/database, run `docker compose up`, and reach a
fully working single-city instance with their own name/colors/logo and no
DinnerBears branding or subdomain assumptions left over.

**Open question — restaurants vs. locations:** the Southwest Ohio group
("Sons") holds dinners at members' houses, not restaurants, so the
`restaurants` entity (`docs/DATABASE_SCHEMA.md`) may need to generalize to
a broader "location" concept (name/address, optionally tied to a member
instead of a business) rather than being restaurant-specific.

**Open question — event date default:** `nextTuesdayDate()` in
`frontend/src/app/features/events/form/event-form-dialog.component.ts`
hardcodes new-event creation to default to next Tuesday at 6:30pm —
DinnerBears' own weekly cadence baked into code. Sons meets monthly, not
necessarily on a fixed weekday, so this default needs to become
configurable (or simply not assume a fixed weekday/time) as part of the
white-label template.
