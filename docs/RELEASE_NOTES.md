# Release 1.0.0 — Production Launch

_Released: 2026-06-21_

Welcome to DinnerBears 1.0.0 — the full production launch of the platform. Everything below was built from the ground up: accounts, events, restaurants, community tools, admin controls, and more.

---

## Accounts & Authentication

**Invite-Only Membership**
DinnerBears is a private, curated community. Every account starts with an invite link issued by an existing member or admin. Multiple invite types are supported: personal member invites, admin multi-use links, Facebook campaign links, event-specific links (for both full members and non-validated guests), and guest RSVP links. Invite lineage is tracked end-to-end — admins can see the full chain of who invited whom.

**Three Ways to Sign In**
Members can log in with Google, Facebook, or an email address and password. All three methods work with the invite flow. Email accounts require a verification step before activation. A password reset link is always available if you forget yours.

**Connected Accounts**
From Account Settings you can link or unlink Google and Facebook at any time, as long as at least one login method stays connected. You can also add or change your password there.

**Login Security**
Entering the wrong password four times in a row temporarily locks your account — starting at one minute and doubling with each additional failure. A security email goes out immediately, and admins are notified. After a successful login, a brief notice shows your last login date and highlights any failed attempts since then. A persistent bell notification keeps the warning visible until you read it.

**Account Deletion**
You can delete your account at any time from Account Settings. Accounts are soft-deleted immediately with a 30-day recovery window before data is permanently removed. Meta's data deletion callback is fully supported for Facebook-connected accounts.

---

## Events

**Event Calendar**
Upcoming and past dinner events are listed by city with date, restaurant, and RSVP counts. Each event has a detail page with the full description, location, and RSVP panel.

**RSVP**
Members choose Going, Maybe, or Not Going. Only Going RSVPs count toward the reservation headcount — Maybe is informational. You can also bring additional guests: name them, send them an email invite, or copy a shareable RSVP link.

**Guest RSVPs**
Guests without an account can RSVP via a link emailed to them by a member. They receive a confirmation email with a cancel link and an optional invitation to join DinnerBears.

**RSVP Cutoff**
New Going RSVPs are hard-blocked after 5:00 PM on event day, since restaurant reservations are finalized at that point. Moderators can override the cutoff if needed. A reminder of the cutoff time and dinner start time (6:30 PM, arrive ~6:00 PM) appears on every event page.

**Calendar Export**
Export any event to your calendar via a .ics file, a Google Calendar link, or an Apple Calendar deep link.

**Event Discussion**
Members can post comments and replies on any event page. Replies nest one level deep. Members can delete their own posts; moderators can remove any post. Discussions stay visible after the event concludes.

**Event Sharing**
Admins and moderators can copy a formatted event announcement — including the event details and invite links — ready to paste into Facebook or a group message.

---

## Restaurants

**Restaurant Database**
A searchable, filterable list of every venue the group has visited or is considering, organized by city. Each restaurant has a detail page with photos, description, address, website, and a map link.

**Ratings**
Members who attended a past dinner at a restaurant can submit a rating across four dimensions: food, service, value, and noise (each 1–5 stars), plus an optional comment. Aggregate scores and recent reviews appear on the restaurant's detail page. Rating eligibility is enforced server-side — only verified attendees can rate.

**Moderator Venue Tools**
Moderators and admins have access to private venue notes and contact info (name, phone, email) on each restaurant page. These fields are never visible to standard members.

---

## Community

**Member Directory**
A searchable list of all members with their city, role, and avatar. Clicking a member opens their profile page.

**Avatars**
Choose a bear avatar from the picker on your profile. Hit "I Feel Lucky" to get a random one. New bears can be added to the collection at any time without a code change.

**Announcements**
Admins and moderators can post community announcements scoped to one or all cities. Members can comment on announcements.

**Push Notifications**
Opt in to push notifications for new announcements, event updates, and security alerts — on desktop or as a PWA on your iPhone home screen. iOS users see an Add-to-Home-Screen prompt the first time they visit on Safari.

**Notification Bell**
A bell icon in the top bar shows your unread notification count and expands to a dropdown. Notifications are marked read when you open them.

**Notification Preferences**
From your profile's Notifications tab, you can turn off specific email notification types — event reminders, RSVP confirmations, security alerts, and more — without fully unsubscribing.

---

## Feedback & Updates

**Feedback Board**
Members can submit bug reports, feature requests, and general comments. Each ticket supports upvotes, threaded notes, a public/private flag, and a full status trail (open → in progress → resolved → shipped). Shipped tickets are credited in the release notes.

**Public Changelog**
The /updates page lists every published release with full notes and community credit — no login required.

---

## Content Moderation

**Content Reporting**
Members can flag inappropriate event comments, replies, and restaurant ratings using the report button. Reports go to the moderation queue, moderators receive an in-app notification, and can dismiss or remove the content in one click. Members can't report their own content.

**Non-Validated Members**
Public Facebook invite links can create Non-Validated accounts — real accounts with limited access. Non-Validated members can view events and RSVP, but can't post, invite, or submit feedback. A moderator can upgrade them to full Member with a vouch confirmation.

---

## Email

**Transactional Emails**
Eleven email templates cover all key events: invite delivery, registration welcome, email verification, password reset, RSVP confirmation, event reminder, security alert, account lockout, unsubscribe confirmation, account deletion confirmation, and re-engagement.

**Delivery & Reliability**
Emails are queued in the database and dispatched every five minutes via Brevo, with Gmail SMTP as a fallback. Bounce, complaint, and unsubscribe webhooks are processed automatically. Members with delivery issues see an in-app banner with next steps.

---

## Admin Panel

**Users**
Full member list with role, status, email delivery status, and invite lineage. Admins can suspend, delete, change roles, and manually override email suppression for any member.

**Invites & Lineage**
Generate, view, and revoke all invite types. Invite links can be set to never expire or up to 365 days. The Invite Tree view shows the full chain of who invited whom, rendered as an indented hierarchy with role and status at each node.

**Email Dashboard**
Monitor send counts, toggle the Gmail fallback, retry failed messages, and review bounce and complaint logs.

**Feedback Management**
View all feedback tickets including private ones, update statuses inline, and add admin-only notes visible only to the moderation team.

**Audit Log**
A full, filterable audit log captures every significant action — logins, role changes, bans, email suppressions, account deletions, and more. Filterable by event type, member, and date range. Hovering a member name shows a quick card with their photo, providers, and role.

**Cities**
Configure each chapter's details and admin contacts from the Cities tab.

**Releases**
Publish release notes through the admin UI. Publishing auto-bumps the version number in both the frontend and API. Resolved feedback tickets can be linked to a release for community credit.

---

## Security

**Rate Limiting**
All authentication endpoints are rate-limited by IP. Login allows ten attempts per minute; registration and password reset allow five; forgot-password and resend-verification allow three. The first burst from any IP is logged in the audit log.

**OWASP Hardening**
Pre-launch security review completed covering the OWASP Top 10 — input validation, injection prevention, secure cookie handling, and error handling that never exposes stack traces.

---

## Legal

**Terms & Privacy in the App**
The Terms of Service and Privacy Policy are now part of the site — accessible from the footer with the full navigation and site shell, matching the rest of the DinnerBears experience.
