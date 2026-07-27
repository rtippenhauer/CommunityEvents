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
Phase 33 (white-label finishing touches) is complete and merged into `main`. Delivered the four items deferred out of Phase 32 — **de-branded transactional emails** (event-published, RSVP confirmation, reminder, calendar `.ics`/feed now read `brand_name`/`term_dinner_*` via `getEmailBrand()`/`getBrand()` helpers, DinnerBears output unchanged); a **general per-instance feature-toggle framework** (`feature_*` `app_config` rows, default on, gate Ratings/Leaderboard/Merch/Members directory server-side via `FeatureGuard`+`@RequireFeature`, plus a Residence-ratings sub-rule, with matching nav/admin-settings UI); **Founding Member label consistency** (`BrandConfigService.foundingLabel()` — DinnerBears keeps "Founding Bear", every fork reads "Founding Member", wired into all 5 surfaces); and a **location-detail "Private until RSVP" photo cover** mirroring the event-card treatment. Also landed alongside: a **shared release-note pipeline** — release notes now ship inside the Docker image (`api/release-notes/<version>.md`) and a boot-time `ReleaseNotesImporterService` auto-publishes them into each instance's own `releases` table (finalized notes everywhere; the in-progress draft on stage only, gated by `IS_STAGE`) — see `docs/RELEASE_NOTE_PIPELINE_SPEC.md`.

No phase is currently scoped/in-progress. Candidates for a future phase: monthly "Nth weekday" event cadence (e.g. "2nd Saturday", carried forward since Phase 29 — needs Sons' schedule to motivate it) and swapping the release-note pipeline's `marked` dependency (pinned `^15.0.12` — v16+ dropped CommonJS support) for `markdown-it`. See wishlist memory for both.

Deployment note: each instance needs its Unraid template set to `NODE_ENV=production` + `IS_STAGE=true` (a `staging` value leaves cookies non-Secure and can leak stack traces).

Phase 28 (retroactive event-achievement sync) is fully merged into `main` and rebuilt to stage (`rtippenhauer/dinnerbears:stage`, 2026-07-20) — not yet in a production release; the next `/release` will pick it up. Toggling an event's secret-dinner flag, or creating/deleting its one-off Special Dinner Achievement, now retroactively syncs points and badges for members already marked attended, scoped to that one event so cost stays flat as the event catalog grows. The Angular 19→22 major upgrade (Phase 27) is done (all 3 npm-audit vulnerabilities that motivated it are closed). The frontend has zero unit tests (`frontend/src/**/*.spec.ts` — none exist) — flagged repeatedly but not yet undertaken; would need its own scoped phase since there's no existing harness/pattern to build on.

The `bugfix-hide-unconfigured-facebook-login` fix is merged into `main` and rebuilt/pushed to prod (`rtippenhauer/dinnerbears:latest`, 2026-07-21) — the Facebook App ID is nulled out on prod until the Facebook app actually completes Go-Live setup.

Phase 22's `BREVO_WEBHOOK_SECRET` follow-up is fully closed as of 2026-07-18: `.env.example` documented, stage/prod `.env` set, and Brevo's dashboard webhook URL updated — webhook events are confirmed flowing.

## Completed Phases
Phases 1, 2, 3, 3.5, 4.1, 4.2, 4.3, 4.4, 4.6, 5, 5.5, 6, 7, 7.5, 7.6, 8, 9, 10, 10.5, 10.6, 11, 12, 13, 14, 15, 16, 16c, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33 ✓ — see PHASES.md for details.

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

