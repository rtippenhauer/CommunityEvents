# Meta / Facebook App Review — Submission Guide

## What You Need Before Submitting

- [ ] A manually created Facebook test account (email + password + 2FA backup codes)
- [ ] A working invite link from Stage admin panel (Guest Member flavor)
- [ ] A screen recording of the full Facebook Login flow (under 2 minutes)

---

## Step 1 — Create a Test Facebook Account

Meta's "Create Test User" dashboard feature is globally disabled. You must manually create a dedicated Facebook account for the reviewer.

1. Create a new Facebook account with a real email address (use a Gmail alias like `rtippenhauer+fbtest@gmail.com`)
2. Complete basic profile setup
3. Go to **Settings → Security and Login → Two-Factor Authentication**
4. Enable 2FA via an Authenticator App
5. Generate **Recovery/Backup Codes** — copy 3-4 of them
6. Add this account as a **Tester** in Meta Developer Console → Your App → Roles → Testers

> **Why 2FA codes matter:** Meta's reviewer may log in from a different country, which triggers Facebook's security block. The recovery codes let them bypass it.

---

## Step 2 — Record a Screen Video (Required, Under 2 Minutes)

Record the following flow with Loom, QuickTime, or any screen recorder:

1. Show the Stage login page at `https://stage.dinnerbears.com`
2. Show the **"Continue with Facebook"** button — must use official Facebook blue + "f" logo
3. Click the button — capture the official Meta permission dialog appearing
4. Show the user granting permission
5. Show the redirect back to the app — user is logged in, profile name and photo visible
6. Briefly show navigation (Events, Restaurants, Members)

Keep it under 2 minutes. Upload to the **documents-web-1** field.

---

## Step 3 — Form Field Responses

### instructions-web-2

> DinnerBears is an invite-only community dining platform that organizes weekly group dinners. Our production deployment is in progress — for review, please use our staging environment which is identical to production and uses the same Facebook App ID:
>
> https://stage.dinnerbears.com
>
> **How to access:**
> 1. Visit this invite link: `[PASTE INVITE LINK HERE]`
> 2. Click "Continue with Facebook"
> 3. Log in using the Facebook test account credentials provided below
> 4. You will land in the app and can browse upcoming events, restaurants, the member list, and your profile
>
> **Navigation:**
> - Events — upcoming and past group dinners
> - Restaurants — community restaurant directory with ratings
> - Members — member directory
> - Profile — account settings and linked accounts
>
> **Facebook Login usage:**
> Our application uses Facebook Login to provide a secure, seamless authentication method for our users. We request the `public_profile` and `email` permissions strictly to create a user account in our database, verify their identity, and populate their basic profile layout (name and profile picture) within our app. We do not use this data for marketing or tracking purposes.
>
> We do not request any advanced permissions (user_friends, user_gender, user_birthday, etc.) and we do not post to user profiles, timelines, or friends on their behalf.
>
> **Planned future use — Pages API:**
> We intend to add the Facebook Pages API in a future release so the DinnerBears administrator can post event announcements directly to our own DinnerBears Facebook Page. Posts will be admin-initiated only, to our Page only, and will contain no user personal data. We are disclosing this now to avoid a separate review submission later.
>
> **Note for Reviewer:**
> The dashboard "Create Test User" feature is globally disabled by Meta. We have manually created a dedicated tester account for you. Login credentials and 2FA backup codes to bypass any cross-region security blocks are provided below.

---

### accesscode-web-1

> No payment or membership fee is required.
>
> **Facebook test account:**
> - Email: `[TEST ACCOUNT EMAIL]`
> - Password: `[TEST ACCOUNT PASSWORD]`
> - 2FA Recovery Codes: `[CODE 1]` / `[CODE 2]` / `[CODE 3]`
>
> **Invite link to start the login flow:**
> `[PASTE INVITE LINK HERE]`
>
> Credentials are valid for one year from submission.

---

### accesscode-web-2

> Not applicable — this is a web app, not distributed through any app store and has no in-app purchases.

---

### geo-web-5

> No geographic restrictions. The app is accessible worldwide with no geo-blocking or geo-fencing in place.

---

### documents-web-1

> Upload the screen recording of the Facebook Login flow here.

---

### fblogin-web-1

> Select **Yes**

---

## Checklist Before Hitting Submit

- [ ] Test account created and added as Tester in Meta Developer Console
- [ ] Logged into Stage using the test account via the invite link — confirmed it works end to end
- [ ] 2FA enabled on test account and backup codes saved
- [ ] Screen recording uploaded
- [ ] Invite link is active and has uses remaining
- [ ] All placeholders in the form responses above are filled in
