# Facebook App Setup Guide

_For DinnerBears — Facebook OAuth Login only_
_Last updated: 2026-06-03_

## What This App Does (and Doesn't Do)

As of 2024, Meta deprecated the `publish_to_groups` permission and the Facebook
Groups API for third-party apps. DinnerBears therefore uses Facebook only for:

✅ **Facebook OAuth Login** — members can sign in with their Facebook account
✅ **Historical event pull** — one-time read of past group events for restaurant import
❌ ~~Automated group posting~~ — not possible via API
❌ ~~Facebook Event creation~~ — not possible via API
❌ ~~Attendee count sync~~ — not possible via API

Facebook sharing is handled via the manual "Share to Facebook" button on event
pages, which opens Facebook's web composer with pre-filled text. No API
credentials are needed for that feature.

---

## Part 1 — App Already Created

The DinnerBears Meta App has been created at developers.facebook.com.
Retrieve your credentials from **Settings → Basic**:

```dotenv
FACEBOOK_APP_ID=your_app_id
FACEBOOK_APP_SECRET=your_app_secret
```

---

## Part 2 — Facebook Login Configuration

1. In the left sidebar go to **Facebook Login → Settings**

2. Under **Valid OAuth Redirect URIs**, add:
   ```
   http://localhost:8080/api/v1/auth/facebook/callback
   https://dinnerbears.com/api/v1/auth/facebook/callback
   https://cincinnati.dinnerbears.com/api/v1/auth/facebook/callback
   https://dayton.dinnerbears.com/api/v1/auth/facebook/callback
   ```

3. Click **Save Changes**

---

## Part 3 — App Settings

1. Go to **Settings → Basic** and fill in:
   - **Privacy Policy URL:** `https://dinnerbears.com/privacy.html`
   - **Terms of Service URL:** `https://dinnerbears.com/terms.html`
   - **App Icon:** DinnerBears logo (1024×1024 px)
   - **Category:** `Entertainment`
   - **App Domains:** `dinnerbears.com`

2. Click **Save Changes**

---

## Part 4 — Development Mode vs Live Mode

**Development mode (current):**
- Facebook Login works only for you and anyone added as a Tester
- Good for building and testing through Phase 3
- No business verification required

**Adding testers during development:**
1. Go to **App Roles → Roles**
2. Click **Add Testers**
3. Add members by their Facebook username (up to 100 testers)

**Going Live:**
To allow all members to log in with Facebook, the app must be switched to
Live mode. This requires:
- Business verification using **DinnerBears LLC** credentials
- Business email: `admin@dinnerbears.com` (set up via Cloudflare Email Routing)
- App Review for `email` and `public_profile` permissions (usually fast —
  these are standard permissions with no group access)

Submit for Live mode when the app is ready for real users (end of Phase 3).

---

## Part 5 — Historical Event Pull (Phase 3.5)

Reading past events from a Facebook group you admin is still supported by
the Graph API. The import script uses your admin user token to call:

```
GET /v18.0/{group-id}/events?fields=name,start_time,place,description&limit=100
```

This requires only `user_groups` permission, which is granted automatically
when you authenticate as a group admin. No special App Review needed.

The token is obtained when you log into DinnerBears with Facebook OAuth during
Phase 3 setup. The import script is a one-time Claude Code operation.

---

## Part 6 — .env Reference

```dotenv
FACEBOOK_APP_ID=your_app_id
FACEBOOK_APP_SECRET=your_app_secret
FACEBOOK_GROUP_1_CINCINNATI_ID=your_cincinnati_group_id
FACEBOOK_GROUP_1_DAYTON_ID=your_dayton_group_id
FACEBOOK_GROUP_2_DAYTON_ID=your_second_dayton_group_id
```

### Finding Your Group IDs
1. Go to your Facebook group in a browser
2. The numeric ID appears in the URL:
   `https://www.facebook.com/groups/123456789` → ID is `123456789`

---

## Checklist

- [x] Meta App created at developers.facebook.com
- [x] App ID and App Secret retrieved
- [ ] App ID and App Secret added to `.env`
- [ ] Redirect URIs configured in Facebook Login settings
- [ ] Privacy Policy and Terms pages live at dinnerbears.com
- [ ] App icon uploaded
- [ ] Test members added as Testers for development
- [ ] Group IDs added to `.env`
- [ ] Go Live submitted after Phase 3 is complete (requires DinnerBears LLC verification)
