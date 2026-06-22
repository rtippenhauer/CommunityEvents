# Release 1.0.0.
Email & Password Login

Members can now create an account or sign in using an email address and password, in addition to Google and Facebook. Invite links work with all three login methods.

This release includes email verification, password reset, and account password management from Account Settings. Members who originally signed in with Google or Facebook can now add a password to their account, and existing password users can change their password at any time.

Verification and password reset emails are sent immediately and bypass the normal email queue and suppression list so account access messages are not delayed.

Content Reporting

Members can now report inappropriate content across DinnerBears. Comments, replies, and restaurant ratings include a flag option so members can report content with an optional note.

Members cannot report their own content, and duplicate reports on the same item are blocked. Moderators receive an in-app notification for each new report and can review reports from the moderation queue. From there, they can dismiss the report or remove the reported content.

Announcements are not reportable because reporting is limited to user-generated content.

Moderator Tools

Moderators now have a dedicated Moderation menu with access to the member list, announcements management, and the content report queue. This gives moderators the tools they need without exposing admin-only features such as email management, invite management, and system-level settings.

Moderator and admin member cards now show connected login providers, including Facebook and Google indicators. The Facebook badge links directly to the member’s Facebook profile for identity verification, and the Google badge opens a Gmail compose window addressed to the member.

Admin Audit Log

Admins now have a full audit log showing significant activity across the app, including logins, logouts, bans, role changes, email suppression changes, account deletions, and more.

The audit log can be filtered by event type, member name or email, user ID, and date range. Entries paginate at 50 per page, and action chips are color-coded by category for easier scanning.

Hovering over a member name shows a member card with their photo, email, connected login providers, and role, including working provider links.

Invite Tree

Admins now have an Invite Tree view that shows the full chain of who invited whom. The tree starts with founding members and displays each invited member in an indented hierarchy.

Each member in the tree shows their role and account status, making it easier to understand invite history and community growth.

Cities Admin Tab

The admin panel now includes a Cities tab listing each DinnerBears chapter, its admin contacts, and the current member count.

Invite Link Improvements

Admin and campaign invite links can now be set to never expire, making them useful for long-term onboarding.

The maximum invite expiration window has also been increased from 30 days to 365 days.

Email Suppression Controls

Admins can now suppress or restore email delivery for individual members directly from the Users list, without needing to manage this through the email provider dashboard.

Each user row now shows the member’s current email suppression status as a badge.

Login Security Improvements

DinnerBears now protects accounts from repeated failed password attempts. After four incorrect password attempts in a row, the account is temporarily locked.

The lockout starts at one minute and doubles with each additional failed attempt, up to a maximum of ten minutes. The failed-attempt counter resets after thirty minutes of no activity.

When an account is locked, the member receives an immediate security email, and admins and moderators are notified.

Login Notices

After signing in successfully, members now see a brief notice showing the date of their last login.

If there were failed login attempts since the previous successful login, the notice highlights the number of failed attempts and the date. A persistent notification also appears in the member’s notification bell until it has been read.

Authentication Rate Limiting

Authentication endpoints are now rate-limited by IP address to reduce abuse.

The login endpoint allows ten attempts per minute. Registration and password reset allow five attempts per minute. Forgot-password and resend-verification allow three attempts per minute.

When the limit is exceeded, the request is temporarily blocked. The first burst from an IP address is recorded in the audit log, while repeat hits within a thirty-minute window are tracked without flooding the log with duplicate entries.

Safer Account Disconnects

If a member disconnects Facebook from their account and later tries to sign in with Facebook again, DinnerBears now shows a clear error directing them to use Google or another connected login method instead of silently re-linking the Facebook account.

Members can reconnect Facebook at any time from Account Settings.

Unsaved Changes Warning

When editing a guest name or email on an event, leaving the page now prompts the member to confirm before navigating away. This helps prevent accidentally losing unsaved changes.

Bug Fixes
Disconnecting Facebook and then attempting to sign in with Facebook now correctly shows an error instead of silently re-linking the account.
Verification and password reset emails now send immediately and bypass email suppression handling.
Announcements no longer show a report button because only user-generated content can be reported.
Duplicate content reports on the same item are now blocked.
Members can no longer report their own content.
