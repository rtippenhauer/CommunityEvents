# DinnerBears — Development Phases

Update `CLAUDE.md` "Current Development Phase" when moving to a new phase.

---

## Phase 1 — Project Foundation & Design System ✅ Complete

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

## Post-Launch Backlog (unscheduled)

Deferred cleanup items and design spikes. No ordering implied — promote to a
numbered phase when ready to schedule.

### Uploaded File Auth Gating
Currently `/api/uploads/*` is served as a static asset with no auth check.
Profile photo URLs are never leaked to guests or non-validated users via any
API response, so the practical risk is low (no guessable URL scheme). When
prioritized, the fix is:
- Separate restaurant photos and profile photos into `/app/uploads/restaurants/`
  and `/app/uploads/profiles/` respectively (migration + upload-path update)
- Replace `useStaticAssets` for the profiles path with a controller endpoint
  that applies `OptionalJwtAuthGuard` and streams the file only to authenticated users
- Restaurant photos remain static (intentionally public, used in emails to guests)

### Event Card Cleanup
The home-page event card is currently too busy — date/city/restaurant/footer
all compete for attention. Revisit the card layout to simplify the information
hierarchy. Possible directions: reduce font sizes, collapse the footer to
just the RSVP pill on mobile, or rethink the avatar cluster display.

---

## Phase 15 — Community Points System 🔄 In Progress

Gamification layer that rewards engagement and creates a visible community
reputation score ("Bear Points").

### Coordinator Role

The event **coordinator** is the member who suggests the restaurant and makes
the reservation — these are the same action. When an admin creates or edits
an event, they tag a coordinator (any member, including themselves).

- DB: add `coordinator_id` FK (nullable) to `events` table
- Admin event form: "Coordinator" member picker field
- Coordinator is shown on the event detail page alongside the date/restaurant

### Earning Points (proposed)

| Action | Points | Notes |
|---|---|---|
| Attend an event | 1 | Requires `attended = true` (Phase 10) — prevents gaming by RSVPing Going and not showing up |
| Be event coordinator | 2 | Awarded when the event concludes (past + attended cutoff confirmed) |
| Be coordinator at a brand-new restaurant | 4 | Double points when the restaurant has never been used in a prior published event — rewards exploration |
| Successfully invite someone | 1 | Awarded when the invitee attends their **first** dinner (not just account creation) — ensures you brought someone who actually participates |
| Rate a restaurant | 1 | One point per eligible rating submitted (already gated to attendees only) |

The invite rule is intentionally strict: you only get credit once the person
you brought shows up in person. This keeps the community quality high and
prevents invite farming for points.

### Display

- Member profile: "Bear Points" total with a breakdown by category
- Member list: optional sort by Bear Points (off by default)
- Admin: full points ledger per member for auditing/adjustments

### Design Considerations

- **DB**: `member_points` table (id, user_id FK, event_type enum[`attendance`|`coordinator`|`coordinator_new_restaurant`|`invite`|`rating`], reference_id int, awarded_at, points int) — ledger model so points can be corrected or audited without reprocessing history
- **"New restaurant" check**: at event creation time, query whether the restaurant has appeared in any prior `published` event; store the result as a flag on the coordinator point award so it doesn't shift retroactively if the restaurant is later used again
- **Invite point trigger**: fires when the invitee's first `attended = true` record is written — needs to walk the invite lineage to find the original inviter
- **Backfill**: attendance and ratings are retroactively calculable; coordinator and invite points require manual review of historical data since `coordinator_id` doesn't exist yet
- **No abuse vectors**: all triggers are server-side events tied to verifiable DB records; no self-reporting

**Definition of done:** Members earn points for attendance, coordinating, invites (on invitee's first attended dinner), and ratings. Coordinator earns double for introducing a new restaurant. Totals and category breakdown display on profiles. Admin can view and correct the ledger.
