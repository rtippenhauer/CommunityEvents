# DinnerBears.com — Claude Code Project Context

## Project Overview
Community dining platform that organizes weekly group dinners across multiple cities.
Initial cities: Cincinnati and Dayton (cincinnati.dinnerbears.com, dayton.dinnerbears.com).
Self-hosted on Unraid using Docker Compose. Invite-only membership.

## Full Stack
- **Frontend:** Angular 22, standalone components (NO NgModules), Angular Material (MDC), SCSS
- **Backend:** NestJS (Node.js, TypeScript), TypeORM, Passport.js
- **Database:** MySQL 8.x
- **Auth:** JWT sessions + Google OAuth + Facebook OAuth (Passport strategies)
- **Email:** Brevo SDK (primary) + Resend (overflow fallback)
- **Push:** Web Push API with VAPID keys (@angular/pwa service worker)
- **Proxy:** NGINX Proxy Manager (Docker)
- **Containers:** Docker Compose — api and mysql have NO public ports

## Repository Structure
```
dinnerbears/
├── CLAUDE.md                  ← Root context file (Claude reads this first)
├── PHASES.md                  ← Phase breakdown with definitions of done
├── README.md                  ← Full setup instructions
├── .env.example               ← All required env vars documented
├── .gitignore
├── .claude/                   ← Claude Code settings
├── .vscode/                   ← VS Code settings
├── docs/                      ← Requirements, schema, setup guides
├── frontend/                  ← Angular 19 app
│   └── public/                ← Static assets and legacy placeholder pages
├── api/                       ← NestJS API
└── docker/                    ← Docker Compose and NGINX config
```

## Current Development Phase
Phase 38 (frontend unit tests + the www mail-domain fix) is complete and merged
into `main`.

**Correcting a long-standing wrong assumption in this file:** the frontend was
never missing a test harness. `angular.json` already had a `@angular/build:karma`
target, `tsconfig.spec.json` was present and correct, `karma` + `jasmine-core`
were installed, and `ng test` was wired up. Nobody had written a spec. There are
now **91**, covering `BrandConfigService`, all six route guards, `AuthService`,
`authInterceptor`, `SplashService`, and the events/locations/comments/announcements
HTTP services, plus one component spec (`LocationDetailComponent`) pinning Phase
37's residence rate-gating. `npm test` runs headless single-shot (works with no
`CHROME_BIN` set, exits 0); `npm run test:watch` is the interactive form. `api/src`
has one unit spec, `instance-contact.spec.ts`. Deliberately *not* covered: the
other ~18 thin HTTP-wrapper services and the remaining 63 components, which are
mostly template with little logic — more specs there would cost maintenance
without buying signal.

Also fixed here: **`calendar@www.<domain>` bounced every inbound calendar RSVP
reply.** `baseDomain()` applied its `www.` strip only to the `APP_URL` fallback,
so an explicit `BASE_DOMAIN` carrying `www.` flowed into every derived address.
`www.dinnerbears.com` has no MX record, so those replies died at the sender.
Now stripped whatever the source, with 11 unit tests. Prod is *also* patched via
`CALENDAR_ORGANIZER_EMAIL` + `SUPPORT_EMAIL` env overrides; once this ships those
become optional rather than load-bearing.

And `scripts/test-db-up.sh` now brings up the e2e MySQL and waits until it can
actually take an authenticated query. `mysqladmin ping` is not sufficient — on
first-run init the image runs a temporary server that answers ping before root
grants are final, which produced a random-looking `Access denied`.

No phase is currently scoped/in-progress. Raised but not scoped: an admin config
screen so a new instance needs no `.env` edits, and broader CMS work (adding a
menu item + page). Longer-standing: monthly "Nth weekday" event cadence, and
swapping the release-note pipeline's `marked` (pinned `^15.0.12`) for
`markdown-it`.

Deployment note: each instance needs its Unraid template set to `NODE_ENV=production`
+ `IS_STAGE=true` (a `staging` value leaves cookies non-Secure and can leak stack
traces). Images are `rtippenhauer/community-events:stage` and `:latest` — one generic
image serves every instance, with stage vs prod a runtime distinction. Docker Desktop
is allotted ~1.9GiB, which cannot run the Angular *production* build alongside another
container; stage builds then fail with a bare `exit code 1` (an OOM kill). Stop the
test DB first, or raise the allotment.

Prod runs `BASE_DOMAIN=www.dinnerbears.com`, and `www` is genuinely the only public
web host — the apex publishes MX only, no A record. That split is why the mail
derivation had to strip `www` rather than the env var being "wrong". The same value
is also the auth cookie scope, where it means `cincinnati.dinnerbears.com` is a
*sibling* of the cookie domain rather than a child, so sessions would not carry to
city subdomains. Left alone deliberately: nobody uses those subdomains today, and
changing a live cookie domain strands old cookies for up to 7 days. Revisit before
promoting any city subdomain.

Two pre-existing e2e failures live on `main` (`uploads`, `location-privacy`) plus
two `calendar.e2e-spec.ts` typecheck errors — unrelated to recent work, but they
make "the suite is green" a claim worth checking rather than assuming.

Phase 22's `BREVO_WEBHOOK_SECRET` follow-up is fully closed as of 2026-07-18:
`.env.example` documented, stage/prod `.env` set, and Brevo's dashboard webhook URL
updated — webhook events are confirmed flowing.

## Completed Phases
Phases 1, 2, 3, 3.5, 4.1, 4.2, 4.3, 4.4, 4.6, 5, 5.5, 6, 7, 7.5, 7.6, 8, 9, 10, 10.5, 10.6, 11, 12, 13, 14, 15, 16, 16c, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38 ✓ — see PHASES.md for details.

## Angular Conventions (STRICT)
- **Standalone components only** — never use NgModules
- **Reactive Forms only** — never use template-driven forms
- **Typed services for all HTTP** — never call HttpClient directly in components
- **Angular Signals** for local state
- **Functional route guards** — use `CanActivateFn`
- **Lazy-loaded routes** — each feature is a lazy route group
- **Angular Material** — use Mat components wherever one exists

## NestJS Conventions (STRICT)
- **One module per feature** — AuthModule, UsersModule, RestaurantsModule, etc.
- **DTOs with class-validator** for all request bodies
- **Guards for all protected routes** — never trust client role state
- **TypeORM repositories** — no raw SQL except in migrations
- **Global prefix** `/api/v1` set in main.ts
- **Never expose stack traces** — GlobalExceptionFilter handles all errors

## Database
- MySQL 8.x via TypeORM
- `synchronize: false` always — migrations only
- Migrations in `api/src/database/migrations/` with timestamp prefix
- See `docs/DATABASE_SCHEMA.md` for full schema

## Bug-Driven Development Workflow

When asked to work on bugs, Claude Code should:

1. Call `GET /api/v1/admin/feedback/open-bugs` to retrieve all open bug tickets
2. Present the list to Rob and ask which to work on
3. Implement the fix
4. Call `PATCH /api/v1/admin/feedback/:id/status` with `{status: "resolved"}` on the fixed ticket
5. Add an admin note via `POST /api/v1/admin/feedback/:id/notes` summarizing what was changed

## Branching Workflow

Each phase gets its own branch off `main`, created via `/phase-start`. All
work for that phase — commits, `/phase-done`'s doc updates — happens on the
branch, never directly on `main`. `main` only changes when a phase's branch
merges in, which now happens as part of `/phase-done` itself (via a GitHub
PR, merged with a real merge commit — never squash, so the phase's local
`phase-<N>` tag and full commit history stay reachable from `main`). By the
time `/release` runs, the phase branch is already merged and deleted.

The full arc of a phase is three commands:

| Command | Does | Touches `main`? |
| --- | --- | --- |
| `/phase-start <N>` | Cuts the phase branch | No |
| `/phase-testing <N>` | Pushes the **unmerged** branch to stage + gives Rob testing notes | No |
| `/phase-done <N>` | Docs, tag, merge to `main`, re-stamp stage | Yes |

`/phase-testing` exists so a phase gets exercised on a real container while it
is still cheap to fix — an unmerged branch. Fixes found during testing go on
the same branch and it is re-run; only once Rob confirms stage looks right does
`/phase-done` merge. It can be run as many times as needed and never touches
`main`, tags, docs, or `:latest`.

`/phase-done` rebuilds stage again at the end. That is a re-stamp, not a second
deploy: the merge commit becomes `main`'s HEAD (and the footer shows the running
commit), and the `docs/NEXT_RELEASE.md` entry written in step 1 ships in
`release-notes/_draft.md` for the first time, which is what surfaces the phase
on stage's `/updates` page.

Pushing a stage image never deploys it — the Unraid container has to be
restarted by hand, every time.

Branch naming: `phase-<number>-<kebab-case-slug>`, e.g.
`phase-25-angular-19-22-upgrade`.

Bug fixes and other ad hoc work that aren't tied to a phase still need a
branch, not a direct commit to `main` — reuse the current phase's branch if
one is in progress, otherwise create a short-lived `bugfix-<slug>` branch.
Since phase branches no longer stay open until `/release`, a bugfix branch
merges into `main` on its own (same PR + real-merge-commit approach) once
the fix is ready, rather than waiting to ride along with a phase merge.

## Versioning Workflow

`package.json` version and the public release version (`/admin/releases/new`,
stored in the `releases` table) are separate. Version numbers only change via
the `/release` command, and only when Rob gives the number explicitly — never
bump it proactively.

`docs/NEXT_RELEASE.md` is a running draft of unreleased, customer-facing
changes — updated automatically by `/phase-done` when a phase wraps, and by
hand for ad hoc work in between (e.g. "add this to the next release notes").
It's purely a local staging file — appending to it never touches the
`releases` table or the production API. `/release` reads it as the starting
draft and clears it back to empty once that release's draft is created.

When asked to cut a release:

1. Summarize all changes made in the session (features added, bugs fixed)
2. Recommend a semver bump: patch for bug-only, minor for any new features
3. Draft release note copy for Rob to review, starting from `docs/NEXT_RELEASE.md`
4. When Rob gives a version number, run `/release <version>`, which:
   - Assumes `main` is already up to date — the phase branch merge happened
     back at `/phase-done`, not here — but merges any leftover ad hoc
     `bugfix-<slug>` branch into `main` first if one is still open
   - Creates the release as an **unpublished draft** via `POST
     /api/v1/admin/releases` against production (cookie-authenticated as
     admin — never calls the `/publish` endpoint)
   - Bumps `package.json` version in both workspaces on `main`, clears
     `docs/NEXT_RELEASE.md`, commits, tags, pushes
   - Builds/pushes the stage and prod Docker images
5. Rob reviews the draft and publishes it himself via the admin UI at
   `/admin/releases/new` — publishing is always a manual, separate action,
   never done by Claude

