# Release 0.1.6

_Released: 2026-06-19_

## What's New

**Content Reporting**
Members can now report inappropriate content across the app. If you see a comment, reply, or restaurant rating that violates community standards, tap the flag icon to report it with an optional note. You can't report your own content, and duplicate reports on the same item are blocked. Moderators receive an in-app notification for every new report and can dismiss it or remove the content directly from the moderation queue.

**Safer Account Disconnects**
If you've removed Facebook from your Connected Accounts, trying to sign back in with Facebook will now show a clear error directing you to use Google instead — rather than silently re-linking the accounts. Reconnecting Facebook is always available from Account Settings when you want it.

**Unsaved Changes Warning**
When editing a guest name or email on an event, navigating away from the page will now prompt you to confirm before leaving so you don't lose your changes.

**Admin: OAuth Provider Badges**
The admin user list now shows which login providers (Facebook, Google) are linked to each account. Facebook badges link directly to the member's profile for identity verification.

**Invite Links: No Expiry Option**
Admin and campaign invite links can now be set to never expire — useful for long-term onboarding links. The maximum expiry window has also been raised from 30 to 365 days.

---

# Release 0.2.0

_Released: 2026-06-20_

## What's New

**Email & Password Login**
Members can now create an account or sign in using an email address and password, in addition to Google and Facebook. Invite links work with all three methods. Password reset and email verification are included — reset emails arrive immediately rather than waiting in the queue. OAuth users can add a password from Account Settings, and existing password users can change theirs there too.

**Facebook Profile Verification for Moderators**
Moderators and admins now see Facebook and Google indicators on member cards and profile pages. The Facebook badge links directly to the member's Facebook profile for identity verification. The Google badge opens a Gmail compose window pre-addressed to the member.

**Moderator Navigation**
Moderators now have a dedicated Moderation menu giving them access to the member list, announcements management, and the content report queue — without the admin-only tools like email and invites.

**Bug Fixes**
- Disconnecting Facebook and then signing back in with Facebook now correctly shows an error instead of silently re-linking the account
- Verification and password reset emails now bypass the suppression list and send immediately
- Announcements no longer show a report button — only user-generated content (comments, ratings) can be reported
