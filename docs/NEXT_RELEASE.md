# Next Release — Draft Notes

Running draft of unreleased, customer-facing changes. Appended to automatically
by `/phase-done` when a phase wraps, and by hand for ad hoc work in between.
`/release` uses this file as the starting draft and clears it back to empty
once that release's draft has been created.

## Reliability & Security Hardening

- Tightened server-side validation across several admin tools (achievements,
  custom icons, email settings, member titles) so invalid or oversized input
  is now rejected with a clear error instead of silently going through or
  failing unexpectedly
- Announcements now go through the same content-cleaning pass as feedback and
  release notes, closing a small inconsistency between those areas
- Added a large batch of automated tests specifically probing oversized
  input and malicious-looking text across the platform, confirming the app
  handles it safely everywhere it was checked

## Rate Limiting & Webhook Security

- Strengthened rate limiting across the platform: write actions (creating,
  editing, deleting) are now capped at 30 per minute, with a handful of
  especially sensitive actions (like public RSVP links and bulk admin
  operations) capped even lower, reducing the risk of abuse or accidental
  overload
- Closed a gap where Brevo's email delivery/bounce/unsubscribe notifications
  arrived without any verification — those notifications now require a
  shared secret before being accepted

## Security Audit (Phase 23)

- Ran a full 20-point security checklist against the platform (password
  hashing, session cookies, rate limiting, input validation, IDOR checks,
  admin guards, deleted-data handling, and more) — 16 of 20 already passed
- Tightened the login rate limit from 10 to 5 attempts per minute
- Fixed a gap where a member's notification-preferences update could,
  under a crafted request, overwrite another member's preferences instead
  of their own

## Code Cleanup (Phase 24)

No user-visible changes — internal maintenance to keep the codebase easy to
maintain going forward, verified with the full automated test suite before
and after every change.

- Removed unused code and files across the app, including a leftover email
  provider that had already been replaced and a one-time data-import script
  whose job was long finished
- Consolidated a handful of places where the same logic (like formatting
  event times or building calendar invites) had been copy-pasted into
  several files, into a single shared version each
- Cleaned up outdated project dependencies — removed several no-longer-used
  packages and added a few that were being relied on without being formally
  listed
