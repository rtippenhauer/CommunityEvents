# Standing Up a New Instance (White-Label Fork)

This guide walks a new operator through cloning this codebase into a **separate,
independently-branded community-dining site** — its own domain, database,
secrets, and branding, running alongside (not inside) DinnerBears. The result is
a single-region instance: no city subdomains, one community, your name and
colors, no DinnerBears branding left over.

If you're setting up a local dev environment instead, see [DEV.md](DEV.md).

---

## 0. What you'll end up with

- A Docker image serving your Angular frontend + NestJS API + NGINX on one host.
- A MySQL database with your one city, your branding, and your first admin.
- Members sign in with Google (and optionally Facebook) or email + password.
- Everything city-scoped collapses to your single region automatically — the
  city selector/filter is hidden, and the app serves straight from your apex
  domain with no `city.` subdomain required.

## 1. Prerequisites

- A server that runs Docker (these instructions assume Unraid + Docker Compose,
  but any Docker host works — see [docker/docker-compose.yml](../docker/docker-compose.yml)).
- A MySQL 8.x database (the compose stack does **not** run MySQL for you; point
  `DB_*` at your own instance).
- A domain you control, e.g. `sons.example.com`, with DNS pointing at your host.
- A TLS-terminating reverse proxy (NGINX Proxy Manager, Caddy, Cloudflare, etc.).

## 2. Clone the repo

```bash
git clone <your-fork-url> myinstance && cd myinstance
```

You own this copy — you'll swap a couple of static image files and set your own
secrets, but you do **not** need to edit application code to rebrand.

## 3. Create external accounts & secrets

You need your own credentials for each integration — never reuse DinnerBears'.

### 3a. Google OAuth (required — sign-in)
1. Create an OAuth 2.0 Client (Web application) in the Google Cloud Console.
2. Authorized redirect URI: `https://YOUR_DOMAIN/api/v1/auth/google/callback`
   (must exactly match your `APP_URL` + `/api/v1/auth/google/callback`).
3. Copy the client ID/secret into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

### 3b. Facebook Login (optional)
Follow [FACEBOOK_APP_SETUP.md](FACEBOOK_APP_SETUP.md) with your own Facebook app.
Leave `FACEBOOK_APP_ID` unset to hide the Facebook button entirely until you've
completed Facebook's Go-Live review.

### 3c. Email — Brevo (required) + Resend (optional overflow)
1. Create a [Brevo](https://www.brevo.com/) account, verify your sending domain,
   generate an API key → `BREVO_API_KEY`. Set `BREVO_FROM_EMAIL` /
   `BREVO_FROM_NAME` to your verified sender.
2. (Optional) A [Resend](https://resend.com/) account provides overflow/fallback
   sending → `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_FROM_NAME`.
3. You can also set these credentials later from the admin UI — they live in the
   `email_provider_config` table and the DB values override the env vars.

### 3d. Web-push (VAPID) keys (required for push notifications)
```bash
npx web-push generate-vapid-keys
```
Copy the public/private keys into `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`, and
set `VAPID_SUBJECT` to a `mailto:` address you control.

### 3e. Google Maps Platform (required for geocoding + place enrichment)
Create an API key with the Geocoding and Places APIs enabled →
`GEOCODING_API_KEY` and `GOOGLE_PLACES_API_KEY`.

### 3f. Anthropic (optional — location enrichment)
`ANTHROPIC_API_KEY` powers the "enrich location" admin helper. Leave unset to
disable it.

### 3g. App secrets
Generate random values (`openssl rand -hex 32`) for `JWT_SECRET`,
`SESSION_SECRET`, and `EMAIL_SUPPRESSION_SALT`.

## 4. The `.env` checklist

Create your instance `.env` (on Unraid, the container reads
`/app/appdata/.env`). Group by purpose:

```dotenv
# ── Core ──────────────────────────────────────────────────────────────────
NODE_ENV=production
APP_URL=https://YOUR_DOMAIN            # your canonical URL, no trailing slash
BASE_DOMAIN=YOUR_DOMAIN               # bare domain for cookie scope + derived emails
PORT=3000

# ── Database (point at YOUR MySQL) ────────────────────────────────────────
DB_HOST=...
DB_PORT=3306
DB_NAME=...
DB_USER=...
DB_PASSWORD=...

# ── Auth ──────────────────────────────────────────────────────────────────
JWT_SECRET=...
SESSION_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
# FACEBOOK_APP_ID=...        # omit to hide the Facebook login button
# FACEBOOK_APP_SECRET=...

# ── Email ─────────────────────────────────────────────────────────────────
BREVO_API_KEY=...
BREVO_FROM_EMAIL=hello@YOUR_DOMAIN
BREVO_FROM_NAME=Your Name
# RESEND_API_KEY=...         # optional overflow provider
# RESEND_FROM_EMAIL=...
# RESEND_FROM_NAME=...
EMAIL_SUPPRESSION_SALT=...

# ── Push ──────────────────────────────────────────────────────────────────
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@YOUR_DOMAIN

# ── Maps / enrichment ─────────────────────────────────────────────────────
GEOCODING_API_KEY=...
GOOGLE_PLACES_API_KEY=...
# ANTHROPIC_API_KEY=...      # optional

# ── White-label contact addresses (all optional) ──────────────────────────
# Each derives a sensible default from BASE_DOMAIN when unset:
#   SUPPORT_EMAIL           → hello@BASE_DOMAIN     (calendar-feed reply-to)
#   CALENDAR_ORGANIZER_EMAIL→ calendar@BASE_DOMAIN  (calendar feed "from")
#   EVENT_ORGANIZER_EMAIL   → noreply@BASE_DOMAIN   (.ics event organizer)
# SUPPORT_EMAIL=...
# CALENDAR_ORGANIZER_EMAIL=...
# EVENT_ORGANIZER_EMAIL=...
```

> Set `APP_URL`/`BASE_DOMAIN` and the contact addresses follow automatically —
> you only override them if you want addresses on a different domain than the
> site. There is no leftover `dinnerbears.com` assumption to remove by hand.

## 5. Branding

**Name, tagline, and colors** are all editable at runtime from **Admin → Site
Settings** (`/admin/settings`) once you're signed in — no rebuild. You can also
pre-seed them in step 7 (bootstrap) via `INSTANCE_*` env vars.

**Images** (logo, login splash, small app/favicon icon) can be uploaded from the
same Site Settings screen and apply immediately. Two things upload can **not**
change at runtime, because they're static files served before the app boots —
edit these in your fork if you want them fully branded, then rebuild:

- `frontend/src/index.html` — the `<title>` and `<meta name="theme-color">`.
- `frontend/public/manifest.webmanifest` — the installed-PWA name + icon
  (`frontend/public/images/`), used when a member installs the app to their home
  screen. (The in-app favicon *does* update at runtime from your uploaded icon;
  only the installed-PWA icon needs the file swap.)

## 6. Build & start the stack

```bash
docker compose -f docker/docker-compose.yml up -d --build
```

The container entrypoint runs database **migrations automatically** on startup
(creating all tables + the baseline seed data). Watch the logs until you see
`[entrypoint] Migrations complete.`

## 7. Bootstrap your instance (one time)

Migrations leave the database seeded with DinnerBears' *default* cities and
copy. The bootstrap step turns that into **your** instance: one active city,
your branding, an email-config row, and your first admin (email + password).

Run it once, passing your values as env vars. In the production container:

```bash
docker exec \
  -e INSTANCE_CITY_NAME="Southwest Ohio" \
  -e INSTANCE_BRAND_NAME="Sons" \
  -e INSTANCE_BRAND_TAGLINE="Good company, good food." \
  -e INSTANCE_THEME_PRIMARY="#2E7D32" \
  -e INSTANCE_THEME_ACCENT="#2E7D32" \
  -e INSTANCE_THEME_BACKGROUND="#FDFAF5" \
  -e INSTANCE_ADMIN_EMAIL="you@YOUR_DOMAIN" \
  -e INSTANCE_ADMIN_NAME="Your Name" \
  -e INSTANCE_ADMIN_PASSWORD="a-strong-password" \
  dinnerbears-api node /app/dist/bootstrap.js
```

(From a local checkout with DB access you can instead run `cd api && npm run
bootstrap` with the same env vars.)

| Variable | Required | Notes |
| --- | --- | --- |
| `INSTANCE_CITY_NAME` | ✓ | Your region/community name |
| `INSTANCE_CITY_SUBDOMAIN` | | Defaults to a slug of the name |
| `INSTANCE_BRAND_NAME` | | Leave unset to keep editing later in the UI |
| `INSTANCE_BRAND_TAGLINE` | | |
| `INSTANCE_THEME_PRIMARY` / `_ACCENT` / `_BACKGROUND` | | `#RRGGBB` |
| `INSTANCE_ADMIN_EMAIL` | ✓ | Your login |
| `INSTANCE_ADMIN_NAME` | | Defaults to "Admin" |
| `INSTANCE_ADMIN_PASSWORD` | ✓ | For the first sign-in |
| `INSTANCE_BOOTSTRAP_FORCE` | | `true` to re-run against a non-empty DB |

The script is **idempotent** and refuses to run on a database that already has
real members (unless `INSTANCE_BOOTSTRAP_FORCE=true`), so it can't clobber a live
instance by accident. It only overrides the branding values you actually pass —
anything omitted keeps its default for you to edit later in the UI.

## 8. First sign-in & finish in the UI

1. Visit `https://YOUR_DOMAIN` and sign in with your bootstrap admin
   email + password.
2. Finish branding under **Admin → Site Settings**: upload your logo / splash /
   icon, tweak colors, set the app name/tagline.
3. Set your defaults there too: **Location Privacy** (public restaurants vs.
   addresses hidden until RSVP) and the **New Event** default day/time.
4. Start inviting members from the invite screens.

## 9. Known limitations / follow-ups

- **Event cadence** supports a fixed weekly day/time only. A monthly
  "Nth weekday" pattern (e.g. "2nd Saturday") isn't built yet.
- **Installed-PWA icon** requires the static file swap in step 5 (the in-app
  favicon updates at runtime; the home-screen icon does not).
- **Email copy** still refers to the platform generically; the sending domain
  and addresses are yours, but templated wording is not per-instance
  configurable.
