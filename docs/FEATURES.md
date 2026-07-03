# DinnerBears — Created Features

A complete list of features built for DinnerBears, grouped by area. See `PHASES.md` for the
build order and technical definitions of done, and `RELEASE_NOTES.md` / `/updates` for the
member-facing changelog.

_Last updated: 2026-07-02 (through Phase 16c)._

---

## Accounts & Authentication

- **Invite-only membership** — every account starts from an invite link. Types: personal member
  invite (single-use, 48hr), admin multi-use link, Facebook campaign link, per-event member/
  non-validated links, and guest RSVP links. Full lineage tracking (who invited whom).
- **Three sign-in methods** — Google OAuth, Facebook OAuth, and email/password (with email
  verification and password reset).
- **Account linking** — connect or disconnect Google/Facebook/email-password from Account
  Settings, as long as one method stays connected.
- **Login security** — escalating lockout after 4 failed attempts (1 min, doubling), security
  email + admin notification on lockout, last-login banner with failed-attempt warnings, device
  fingerprinting with new-device alerts.
- **Account deletion** — self-service two-step deletion (soft delete, 30-day recovery, then
  hard delete/anonymization). Full Meta data-deletion callback support for Facebook-linked
  accounts.
- **Non-Validated members** — limited-access accounts created via public Facebook invite links
  (can view/RSVP, cannot invite/post/give feedback); moderators can vouch to upgrade to full
  Member.

## Events

- **Event calendar** — city-filtered upcoming/past listings with restaurant, date/time, and
  RSVP counts; full detail page per event.
- **RSVP system** — Going / Maybe / Not Going, with only Going counting toward the venue
  headcount. Add named guests, email a +1 invite, or share an RSVP link.
- **Guest RSVP** — no-account RSVPs via emailed link, with confirmation email, cancel link, and
  an optional invite to join DinnerBears.
- **RSVP cutoff** — new Going RSVPs hard-blocked after 5:00 PM day-of; moderators can override.
- **Calendar export** — .ics download, Google Calendar link, Apple Calendar deep link.
- **Personal iCal subscription feed** — a per-member calendar URL (token-based, no login
  required by the calendar app) that auto-syncs all RSVP'd events into Apple/Google/Outlook
  calendars, refreshing within 15 minutes of any change.
- **Calendar invite replies** — RSVP confirmation emails include a native `.ics` invite; tapping
  Accept/Maybe/Decline in iOS Calendar sends a reply email that's processed automatically
  (via Cloudflare Email Routing) and updates the member's DinnerBears RSVP.
- **Event discussion** — threaded comments (one reply level deep) on every event page; members
  can delete their own posts, moderators can delete any post; persists after the event.
- **Attendance tracking** — moderators mark who actually showed up after an event concludes;
  drives rating eligibility and Bear Points.
- **Event sharing** — one-click "Copy Event Post" with formatted announcement text and the
  correct invite links, ready to paste into Facebook.
- **Reservation coordinator** — assign a member to arrange the venue reservation, with contact
  info and a confirmation token.

## Restaurants

- **Restaurant database** — searchable/filterable list by city, with photos, description,
  address, website, and map link. Admin/moderator CRUD with soft delete.
- **Historical import** — one-time Facebook Graph API pull of past group events, cleaned and
  imported with automatic geocoding.
- **Ratings** — members who attended a past dinner (verified attendance, not just RSVP) can
  rate food, service, value, and noise (1–5 stars) plus a comment; aggregate scores and recent
  reviews shown on the restaurant page.
- **Moderator venue tools** — private notes and contact info (name/phone/email) visible only
  to moderators/admins, gated server-side.

## Community

- **Member directory** — searchable list with city, role, and avatar; click-through profiles.
- **Avatar system** — pick a bear avatar from a picker that auto-populates from the asset
  folder (no code change needed to add new bears); "I Feel Lucky" random picker.
- **Announcements** — admin/moderator posts scoped to one or all cities, with member comments.
- **Push notifications** — Web Push (VAPID) for announcements, event updates, and security
  alerts; works on desktop and as an iOS home-screen PWA (with an install-prompt banner).
- **Notification bell** — unread badge, dropdown, mark-as-read, near-real-time updates.
- **Notification preferences** — per-template opt-in/out from the profile Notifications tab.
- **Bear Points** — server-verified points for attending (1), coordinating (2, +4 at a
  brand-new restaurant), successful invites (1), and ratings (1). Ledger-based for auditability.
- **Achievements & Titles** — milestone badges (Founding Bear, First Dinner, Regular, Veteran,
  Coordinator, Scout, Connector, Critic, plus tier ladders), some of which unlock a display
  title the member can select on their profile.
- **Leaderboard** — public `/leaderboard`, global by default with a city filter, ranked by Bear
  Points with active title shown.
- **Member list enhancements** — alphabetical or newest-first sort, "New" badge for accounts
  under 14 days old.

## Feedback & Updates

- **Feedback board** — members submit bugs/features/comments, upvote, and hold threaded
  discussions; public/private flag; full status lifecycle (open → in progress → resolved →
  shipped → closed/won't fix).
- **Public changelog** (`/updates`) — every published release with rich-text notes and
  community credit for the reporting member (or "a community member" if private).
- **Release publishing** — admin composes release notes, links resolved tickets for credit,
  and publishing auto-bumps the version number in both frontend and API.

## Content Moderation

- **Content reporting** — a reusable report button on event comments/replies, announcement
  comments, and restaurant ratings; goes to a moderator queue with one-click dismiss or
  remove; duplicate/self-reports blocked.

## Email

- **Transactional email system** — 11 templates (invites, welcome, verification, password
  reset, RSVP confirmation, event reminder, security alert, lockout, unsubscribe, deletion
  confirmation, re-engagement), sent via Brevo with Gmail SMTP fallback, dispatched from a
  database queue every 5 minutes.
- **Deliverability handling** — bounce/complaint/unsubscribe webhook processing, hash-based
  suppression list survives account deletion and re-registration, in-app banners for affected
  members.
- **Inactivity lifecycle** — automated 60-day re-engagement email, 90-day final warning,
  120-day soft delete, 150-day hard delete.

## Admin Panel

- **Users** — full member list with role/status/email health/lineage; suspend, delete, change
  role, override suppression.
- **Invites & lineage** — generate/view/revoke every invite type; indented invite-tree view
  showing the full chain of who invited whom.
- **Email dashboard** — send counts, Gmail fallback toggle, retry failed sends, bounce/
  complaint log.
- **Feedback management** — see all tickets (including private), inline status changes,
  admin-only internal notes.
- **Audit log** — filterable log of logins, role changes, bans, suppressions, deletions, and
  more, with a hover quick-card per member.
- **Cities** — configure each chapter's Facebook group(s) and settings.
- **Releases** — compose and publish release notes with resolved-ticket linking.
- **Restaurant ratings/points/achievements admin** — manual ledger corrections and
  achievement grant/revoke per member.
- **Reports queue** — pending content reports with preview, dismiss or remove-and-dismiss.

## Legal & CMS

- **Terms & Privacy pages** — editable through an admin CMS (versioned, publish/unpublish)
  and rendered inside the full site shell rather than as static placeholder pages.
- **Account deletion info pages** — public self-service instructions page and a status
  lookup page for Meta's async deletion callback.

## Security

- **Rate limiting** — per-IP limits on login (10/min), registration/password-reset (5/min),
  and forgot-password/resend-verification (3/min), with first-burst audit logging.
- **OWASP Top 10 hardening** — pre-launch security review, input validation, injection
  prevention, secure cookies, and a global exception filter that never leaks stack traces.
- **Role-gated data** — moderator-only fields (venue notes/contact, private feedback, admin
  notes) are omitted server-side for standard members, not just hidden in the UI.

## Navigation & UX Polish (Phase 14 / v1.0.1)

- Consolidated desktop nav into grouped dropdowns (Events / Community / Updates), rendered as
  a cream band inset in a thinner dark toolbar.
- Profile split into view-only, edit, and notifications pages.
- Avatar dropdown menu (Profile, Notifications, Linked Accounts, Invites, Sign out).
- Admin/member invite lists gained expired/revoked filter toggles and a per-link hide feature.
