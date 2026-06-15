# DinnerBears — Account Deletion & OAuth Unlinking Requirements

_Last updated: 2026-06-15_
_Status: Ready for Claude Code implementation_
_Priority: High — required for Facebook App Review_

---

## Background

Meta requires that any app using Facebook Login provide a documented, working mechanism for users to delete the data obtained from Facebook. DinnerBears satisfies this with **both** compliance options:

- **Option A (Callback):** A signed POST endpoint at `/api/v1/auth/facebook/deletion-callback` that Meta can call server-to-server to trigger deletion of a specific user's Facebook data.
- **Option B (Instructions URL):** A public page at `/account-deletion` with step-by-step self-service instructions.

Both URLs must be registered in the Meta App Dashboard under **Settings → Basic → Data Deletion**.

### Deletion Policy

| Data | Timing |
|---|---|
| Facebook User ID + OAuth tokens (`oauth_accounts` row) | **Immediate** — at disconnect or account delete |
| Google OAuth tokens (`oauth_accounts` row) | **Immediate** — at disconnect or account delete |
| `login_sessions`, `push_subscriptions` | **Immediate** — at account delete |
| `users.password_hash` | **Immediate** — at account delete |
| `users.profile_photo_path` (if OAuth CDN URL) | **Immediate** — at disconnect of that provider |
| `users` PII (name, email, photo) | **Within 30 days** — anonymized by scheduled cron job |
| Event attendance, audit log | **Retained permanently, anonymized** (tombstone row) |

### Auth Method Rule

A user may only disconnect a provider if they have **at least one other active authentication method** remaining (another OAuth provider, or a password — when email/password auth is added in Phase 6). If the provider being disconnected is their **only** auth method, the only available action is full account deletion.

---

## Requirements

### REQ-DEL-01 — Connected Accounts Panel

The member Account Settings page (`/account/settings`) must include a **Connected Accounts** section showing:

- Google account (email + avatar) — **Disconnect** button if linked and not the only auth method; **Only login method** label (no disconnect button) if it is the only method.
- Facebook account (name + avatar) — same logic.
- Email/Password — **Remove Password** option if linked and not the only auth method (Phase 6; stub the row now, wire behavior later).
- Each row shows current link status with provider icon.
- "Not connected" label for providers not linked — no Connect button (out of scope here).

The UI must determine "only auth method" status from the API response, not from client-side state.

---

### REQ-DEL-02 — Disconnect a Provider (Happy Path)

Applies to Facebook, Google, and (Phase 6) password when the user has at least one other auth method.

1. Show a confirmation dialog:
   > "Disconnect [Provider]? You will no longer be able to log in with [Provider]. Your DinnerBears account and all history will remain."
   > [Cancel] [Disconnect [Provider]]

2. On confirm, the API (`DELETE /api/v1/auth/providers/:provider`) must:
   - DELETE the `oauth_accounts` row for this provider + user.
   - If `profile_photo_path` is a CDN URL belonging to this provider, set it to `NULL` (see REQ-DEL-07).
   - Log to `audit_log`: `action = '<provider>_disconnected'`, `actor_user_id`, `target_user_id`.
   - Send confirmation email: "[Provider] login has been removed from your DinnerBears account."

3. Return user to Account Settings with success toast.
4. No other profile data, RSVPs, history, or posts are affected.

---

### REQ-DEL-03 — Disconnect Blocked (Only Auth Method)

When a user clicks Disconnect on their **only** remaining auth method:

1. The API (`DELETE /api/v1/auth/providers/:provider`) must return `409 Conflict` with a machine-readable error code `ONLY_AUTH_METHOD`.
2. The Angular client handles this by showing a **warning dialog**:
   > "[Provider] is your only way to log in. Disconnecting it will permanently delete your account."
   >
   > "To keep your account, cancel and add another login method first."
   >
   > [Cancel] [Delete My Account Instead]

3. "Delete My Account Instead" opens the account deletion flow (REQ-DEL-04). There is no disconnect-only path.
4. This rule applies symmetrically to all providers and (Phase 6) password.

---

### REQ-DEL-04 — Delete My Account (Self-Service)

A **Danger Zone** section at the bottom of Account Settings contains the Delete My Account button, visually separated with a destructive (red/amber-warn) border.

**Two-step confirmation:**

Step 1:
> "Delete your DinnerBears account? Your account will be immediately deactivated. All login credentials are removed now. Your name and email will be permanently deleted within 30 days. Event attendance history is retained anonymously."
>
> "You will be logged out immediately and cannot undo this."
>
> [Cancel] [Continue]

Step 2 — type-to-confirm:
> "Type DELETE to confirm:"
> [text input]
> [Cancel] [Permanently Delete My Account]

Final button disabled until input exactly matches `DELETE` (case-sensitive).

**On confirm, the API (`DELETE /api/v1/users/me`) must execute in a single database transaction:**

1. `users.status = 'deleted'`
2. `users.deleted_at = NOW()`
3. `users.hard_delete_at = DATE_ADD(NOW(), INTERVAL 30 DAY)`
4. `users.password_hash = NULL`
5. DELETE all `oauth_accounts` rows for this user (**immediate** — satisfies Meta requirement).
6. DELETE all `login_sessions` rows for this user.
7. DELETE all `push_subscriptions` rows for this user.
8. If `users.profile_photo_path` is any OAuth CDN URL, set to `NULL`.
9. Log to `audit_log`: `action = 'account_deleted'`, metadata includes which providers were linked.
10. Queue a deletion confirmation email (send before session invalidation).
11. Invalidate the current session token.

API returns `204`. Angular redirects to `/` with `?deleted=1`, showing toast: "Your account has been deactivated and will be permanently deleted within 30 days."

---

### REQ-DEL-05 — Meta Deletion Callback Endpoint

Meta may POST a signed deletion request server-to-server when a user removes the DinnerBears app from their Facebook account via Facebook's own settings. DinnerBears must handle this.

**Endpoint:** `POST /api/v1/auth/facebook/deletion-callback` (public — no JWT auth)

**Request format from Meta:**
```
Content-Type: application/x-www-form-urlencoded
Body: signed_request=<base64url.signature>
```

**Processing steps:**

1. Parse and verify the `signed_request` using the Facebook App Secret (HMAC-SHA256). Reject with `400` if signature is invalid.
2. Decode the base64url payload. Extract `user_id` (the Facebook App-Scoped ID).
3. Look up the `oauth_accounts` row where `provider = 'facebook'` and `provider_user_id = <user_id>`.
4. If found:
   - Check if the linked DinnerBears user has other auth methods.
   - If yes: delete only the `oauth_accounts` row (equivalent to REQ-DEL-02 happy path). User keeps their account.
   - If no: trigger full account soft-delete (equivalent to REQ-DEL-04 steps 1–10, minus the email confirmation since we may not be able to send it if Facebook was the only identity source — attempt it but don't fail the callback if email is missing).
5. If not found: treat as already deleted — still return success.
6. Generate a unique `confirmation_code` (UUID or similar alphanumeric).
7. Store the code + `user_id` + timestamp in a new `facebook_deletion_requests` table (for audit trail and status lookups).
8. Return **immediately** with:
```json
{
  "url": "https://www.dinnerbears.com/account-deletion/status?code=<confirmation_code>",
  "confirmation_code": "<confirmation_code>"
}
```

**Status page:** `GET /account-deletion/status?code=<code>` — public page that looks up the code and displays one of:
- "Your data deletion request has been received and is being processed."
- "Your data has been deleted." (once hard-delete job runs)
- "Code not found." (invalid code)

**New table required — `facebook_deletion_requests`:**
```sql
id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY
facebook_user_id    VARCHAR(255) NOT NULL       -- Facebook App-Scoped ID
confirmation_code   VARCHAR(100) NOT NULL UNIQUE
dinnerbears_user_id INT UNSIGNED NULL           -- NULL if no matching account found
status              ENUM('pending','completed') NOT NULL DEFAULT 'pending'
requested_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
completed_at        DATETIME NULL
```

The hard-delete cron job (REQ-DEL-06) must update `status = 'completed'` and `completed_at = NOW()` for any matching rows when it processes the user.

---

### REQ-DEL-06 — Anonymization Cron Job (30-Day Hard Delete)

A NestJS `@Cron` task runs daily and processes all users where `hard_delete_at <= NOW()` and `status = 'deleted'`.

For each qualifying user:

1. Overwrite PII on `users`:
   - `full_name = 'Deleted Member'`
   - `email = 'deleted-<id>@deleted.dinnerbears.com'`
   - `password_hash = NULL`
   - `profile_photo_path = NULL`
   - `email_verified_at = NULL`
   - `hard_delete_at = NULL` (marks as processed; `status` stays `'deleted'`)

2. Do NOT delete the `users` row — retained as tombstone for FK integrity (RSVPs, audit log, content flags).

3. Delete any locally stored profile photo file from disk.

4. Update any `facebook_deletion_requests` rows for this user: `status = 'completed'`, `completed_at = NOW()`.

5. Log to `audit_log`: `action = 'account_hard_deleted'`, `actor_user_id = NULL` (system), `target_user_id = <user>`.

> `oauth_accounts`, `login_sessions`, and `push_subscriptions` were already removed at soft-delete time. Nothing to do on those tables here.

---

### REQ-DEL-07 — Profile Photo Cleanup on Provider Disconnect

`users.profile_photo_path` may be a Facebook CDN URL (`fbcdn.net`, `graph.facebook.com`), a Google CDN URL (`googleusercontent.com`), or a local DinnerBears storage path.

Rules:
- Disconnecting Facebook → if photo is a Facebook CDN URL, set to `NULL`.
- Disconnecting Google → if photo is a Google CDN URL, set to `NULL`.
- Account deletion → set to `NULL` unconditionally regardless of source.
- Local photos → scheduled for disk deletion by the cron job at `hard_delete_at`.

---

### REQ-DEL-08 — Public Account Deletion Information Page

Public page at `/account-deletion` — no auth required, accessible by anyone including Meta's App Review team.

**Page content:**

---

**DinnerBears — Account & Data Deletion**

**Remove Facebook Login (keep your account)**

If you have another login method (Google or password) you can disconnect Facebook without deleting your account:

1. Log into DinnerBears.
2. Go to **Account Settings → Connected Accounts**.
3. Click **Disconnect** next to Facebook.
4. Confirm the disconnection.

Your Facebook User ID and access tokens are immediately removed from DinnerBears systems.

**Delete your DinnerBears account**

1. Log into DinnerBears.
2. Go to **Account Settings → Danger Zone**.
3. Click **Delete My Account**.
4. Complete the two-step confirmation.

Your account is immediately deactivated. All Facebook and Google login data is removed immediately. Your name and email are permanently deleted within 30 days. Anonymous event attendance records may be retained.

**No account access?**
Email [support@dinnerbears.com](mailto:support@dinnerbears.com) from the address associated with your account. Include your name and the email address you registered with.

---

This URL (`https://www.dinnerbears.com/account-deletion`) is entered in the Meta App Dashboard under **Settings → Basic → User Data Deletion → Data Deletion Instructions URL**.

The callback URL (`https://www.dinnerbears.com/api/v1/auth/facebook/deletion-callback`) is entered in the **Data Deletion Request URL** field.

---

### REQ-DEL-09 — Admin Cannot Self-Delete

If `users.role = 'admin'`:
- Hide "Delete My Account" button.
- Show: "Admin accounts cannot be self-deleted. Contact another administrator."

---

### REQ-DEL-10 — Deleted Account Login Rejection

All auth callbacks must check `users.status` before creating a session:
- Google OAuth callback: reject if `status = 'deleted'`, return error "This account no longer exists."
- Facebook OAuth callback: same.
- Password login (Phase 6): same.
- Rejection must happen before any session token is issued.

---

### REQ-DEL-11 — Account Settings Page Layout

1. **Profile** — name, email, avatar
2. **Connected Accounts** — provider rows with Disconnect buttons (REQ-DEL-01)
3. **Notifications** — preferences (existing/future)
4. **Danger Zone** — Delete My Account (REQ-DEL-04), destructive visual treatment

---

## Database Changes Required

| Change | Details |
|---|---|
| New table | `facebook_deletion_requests` (REQ-DEL-05) |
| No other schema changes | `users`, `oauth_accounts`, `audit_log` already support all other requirements |

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| DELETE | `/api/v1/users/me` | JWT | Soft-delete current user; body `{ "confirm": "DELETE" }` required |
| DELETE | `/api/v1/auth/providers/:provider` | JWT | Disconnect a provider; returns `409` if only auth method |
| POST | `/api/v1/auth/facebook/deletion-callback` | None (signed request) | Meta server-to-server deletion callback |
| GET | `/account-deletion` | None | Public instructions page |
| GET | `/account-deletion/status?code=` | None | Callback status lookup page |

---

## Meta App Dashboard Configuration

| Field | Value |
|---|---|
| Data Deletion Instructions URL | `https://www.dinnerbears.com/account-deletion` |
| Data Deletion Request URL (Callback) | `https://www.dinnerbears.com/api/v1/auth/facebook/deletion-callback` |
| Privacy Policy URL | `https://www.dinnerbears.com/privacy` |

---

## Affected Files / Modules

| Layer | File(s) |
|---|---|
| NestJS | `auth/auth.controller.ts` — disconnect endpoint + deletion callback |
| NestJS | `auth/auth.service.ts` — disconnect logic, signed_request verification |
| NestJS | `users/users.controller.ts` — DELETE `/api/v1/users/me` |
| NestJS | `users/users.service.ts` — soft-delete logic |
| NestJS | `tasks/hard-delete.task.ts` — new cron job |
| NestJS | `database/migrations/` — `facebook_deletion_requests` table |
| NestJS | `email/templates/` — account-deleted, provider-disconnected templates |
| Angular | `account/account-settings.component` |
| Angular | `account/connected-accounts.component` |
| Angular | `account/delete-account-dialog.component` |
| Angular | `account/disconnect-provider-dialog.component` |
| Angular | `pages/account-deletion.component` (public) |
| Angular | `pages/account-deletion-status.component` (public) |
| Routing | `/account-deletion` and `/account-deletion/status` as public lazy routes |

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| User has Facebook only → clicks Disconnect | API returns `409 ONLY_AUTH_METHOD` → warning dialog → Delete My Account flow |
| User has Google only → clicks Disconnect Google | Same as above |
| Meta callback fires, user has other auth | Only `oauth_accounts` row deleted; DinnerBears account retained |
| Meta callback fires, Facebook was only auth | Full soft-delete triggered; confirmation email attempted |
| Meta callback fires, user already deleted | `facebook_deletion_requests` row created with `status = 'completed'`; `200` returned |
| Meta callback fires, invalid signature | `400` returned; nothing written to DB |
| User deletes account, has active RSVP | RSVP retained with tombstone `user_id`; attendance count unaffected |
| Admin clicks Delete My Account | Button hidden; instructional note shown |
| Deleted user tries to log in | Auth callback rejects before session created |
| Soft-deleted user re-registers with same email | Email scrambled at hard-delete; in the 30-day window, invite flow returns "contact support" |
