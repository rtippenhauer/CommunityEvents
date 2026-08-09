# CommunityEvents — Claude Code Project Context

*Formerly DinnerBears.com.* This repo (`rtippenhauer/CommunityEvents`) was
created specifically for the **CommunityEvents v2.0** rewrite — a genuinely
separate GitHub repository from the one where v1 DinnerBears is actively
developed and deployed (confirmed with Rob 2026-08-09). This repo's `main`
currently contains a snapshot of the v1 codebase (Angular/NestJS/TypeORM/
MySQL, through v1 Phase 38, `package.json` v1.5.1) as the starting point to
build v2 on top of — that snapshot is **not** actively maintained here and
will be progressively replaced as v2 items land, starting with the Prisma
swap. Full v1 history, phase docs, and ongoing v1 fixes live in the old
repo, not this one.

**This matters operationally, not just organizationally:** `rtippenhauer/
community-events:stage` and `:latest` on Docker Hub are the real, currently
serving v1 deployment images. The old repo's tooling builds and pushes
those tags. This repo must never build or push to `:stage`/`:latest` — the
v1-era commands and scripts that could do that (`/phase-start`,
`/phase-testing`, `/phase-done`, `/release`, `scripts/publish-stage.sh`,
`scripts/publish-latest.sh`) have been deliberately removed from this repo
for that reason. v2 work publishes to its own `v2-stage` tag instead (see
"Branching & Release Workflow").

## Project Overview
Community dining platform that organizes weekly group dinners across
multiple cities. v1 runs Cincinnati and Dayton as two full duplicate
deployments (separate container, separate database, settings-driven
branding). v2 replaces that with a single deployment, single database, and
tenant-scoped data — a new tenant (city/community) is a database row, not a
new container/database pair. The underlying product (organizing recurring
group dinners) isn't changing, only the deployment architecture; whether
"tenant" ends up meaning strictly "city" or something broader isn't decided
beyond what `docs/REQ-TENANT-01.md` specifies.

## V2 Rewrite Status

**Current v2 work item:** none started yet — next up is `v2-1` (Prisma data
layer, REQ-TENANT-01.3's first half). Run `/v2-start 1` to begin. See
`V2_PHASES.md` for the full backlog and each item's Definition of Done.

**Infra readiness (as of 2026-08-09, ahead of `v2-1` actually starting):**
- A dedicated `communityevents` database + `communityevents_user` exist on
  the Unraid MySQL server (192.168.2.241) — separate from `dinnerbears`, not
  yet populated with any schema (no migrations run against it yet).
- `rtippenhauer/community-events:v2-stage` has been pushed once already, as
  a pipeline smoke test — it's today's inherited v1 code (commit `6e72d0a`),
  not anything v2-1 produced. Expect this tag to be overwritten by the first
  real `/v2-testing` run.
- The Unraid container (`CommunityEvents-v2-Stage`, from
  `docker/communityevents-v2-stage-unraid.xml`) has been stood up and its
  migrations ran automatically on boot, seeding the usual `automation` role
  user. **The human admin login (`INSTANCE_ADMIN_EMAIL`/`INSTANCE_ADMIN_PASSWORD`)
  has not been confirmed created** — it requires a one-time
  `docker exec CommunityEvents-v2-Stage node /app/dist/bootstrap.js`, which
  was given to Rob but not confirmed run. Check this before assuming the
  instance is usable.
- `APP_URL`/DNS/reverse-proxy for this stage instance were still undecided
  as of this note — confirm with Rob before assuming a domain is live.

V2 is being defined through a sequence of requirements docs. Only one exists
so far: **`docs/REQ-TENANT-01.md` — Tenant Foundation** (status: Draft, not
yet implemented). It is the foundational doc everything else depends on and
defines the conventions the rest of v2 follows. Key decisions it locks in:

- **Prisma replaces TypeORM entirely** (not incrementally) — `schema.prisma`
  becomes the single source of truth, TypeORM removed once Prisma is
  confirmed working end-to-end against the existing schema.
- **Tenant isolation via a single Prisma Client Extension** that
  auto-injects `tenant_id` into `where` clauses and auto-sets it on create
  for tenant-scoped models — not left to individual services to remember.
  Global (non-tenant-scoped) models are excluded by explicit convention.
- **Domain-based tenant resolution**: NestJS middleware resolves
  `tenant_id` from the `Host` header before route handlers run, with
  `www.<domain>` normalized to the same tenant as `<domain>`. Unrecognized
  domains get a clear 404. Result is cached briefly (in-memory, short TTL).
- **`users.tenant_id`** is a single FK (a user belongs to exactly one
  tenant) and email uniqueness becomes per-tenant (`tenant_id`, `email`),
  not global. Auth gains an **email/password** option alongside the
  existing Google/Facebook OAuth.
- **Bootstrap config** (env, set once at container start) shrinks to
  `DB_MODE`, DB connection details, `ROOT_TENANT_URL`. Everything else,
  including the existing `app_config` branding pattern, becomes
  tenant-aware runtime config.
- **Testing stack changes**: Vitest + Supertest for unit/integration,
  Playwright for e2e — replacing the inherited codebase's Jest (`api/`) and
  Karma/Jasmine (`frontend/`).

Required build order (data layer has to exist before there's anything to
scope): Prisma swap → tenants table → domain resolution middleware →
tenant-scoping Client Extension → bootstrap/runtime config split + user
tenant scoping, in that order — tracked as `v2-1` through `v2-5` in
`V2_PHASES.md`. Full requirement-level detail lives in
`docs/REQ-TENANT-01.md`.

Not yet decided/known: whether frontend framework/testing choices beyond
"not Karma" are changing, and what domain scheme v2 tenants use (see the
`www.`/cookie-domain design note under "Multi-Tenancy" below — v2's domain
resolution needs to actually solve this, not inherit v1's workaround).

## Inherited Stack (current `main`, pre-`v2-1`)
This is what's in the repo *today*, carried over from the v1 snapshot. It
will be replaced piece by piece as v2 items land — do not assume it's the
target architecture.
- **Frontend:** Angular 22, standalone components (NO NgModules), Angular Material (MDC), SCSS
- **Backend:** NestJS (Node.js, TypeScript), TypeORM, Passport.js
- **Database:** MySQL 8.x
- **Auth:** JWT sessions + Google OAuth + Facebook OAuth (Passport strategies)
- **Email:** Brevo SDK (primary) + Resend (overflow fallback)
- **Push:** Web Push API with VAPID keys (@angular/pwa service worker)
- **Proxy:** NGINX Proxy Manager (Docker)
- **Containers:** Docker Compose — api and mysql have NO public ports
- **Testing:** Jest (`api/`), Karma/Jasmine (`frontend/`)

## Repository Structure
```
CommunityEvents/
├── CLAUDE.md                  ← Root context file (Claude reads this first)
├── V2_PHASES.md                ← v2 item breakdown with definitions of done
├── README.md                  ← Full setup instructions
├── .env.example               ← All required env vars documented
├── .gitignore
├── .claude/                   ← Claude Code settings (incl. /v2-* commands)
├── .vscode/                   ← VS Code settings
├── docs/                      ← Requirements (incl. REQ-TENANT-01.md), schema, setup guides
├── frontend/                  ← Angular app (inherited v1 code, pre-v2)
│   └── public/                ← Static assets and legacy placeholder pages
├── api/                       ← NestJS API (inherited v1 code, pre-v2)
├── docker/                    ← Docker Compose and NGINX config
└── scripts/                   ← publish-v2-stage.sh (no v1 publish scripts here — see intro)
```

## Angular Conventions (STRICT)
Unchanged by REQ-TENANT-01 (it doesn't touch the frontend); apply to v2
frontend work unless/until a future requirements doc says otherwise.
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
- **Prisma for all data access** once `v2-1` lands — no raw SQL except in
  migrations. Until then the inherited codebase still runs on TypeORM
  repositories; don't add new TypeORM code, that work should go straight
  into the Prisma swap instead.
- **Global prefix** `/api/v1` set in main.ts
- **Never expose stack traces** — GlobalExceptionFilter handles all errors
- **Tenant scoping is automatic, not manual** (from `v2-4` onward) — rely on
  the Prisma Client Extension rather than adding `tenant_id` filters by
  hand in services once it exists

## Database
**Today (inherited, pre-`v2-1`):** MySQL 8.x via TypeORM, `synchronize: false`
always, migrations in `api/src/database/migrations/` with timestamp prefix.
See `docs/DATABASE_SCHEMA.md` for full schema — this is also `v2-1`'s
starting point for modeling `schema.prisma`.

**From `v2-1` onward:** MySQL 8.x via Prisma, `schema.prisma` as the single
source of truth, `prisma migrate dev` locally and `prisma migrate deploy` in
CI/deploy replacing TypeORM's migration files. `prisma/seed.ts` creates the
root tenant on first run if none exists. Once `schema.prisma` exists,
keeping `docs/DATABASE_SCHEMA.md` in sync is a nice-to-have for human
readability, not a correctness requirement.

## Multi-Tenancy (from `v2-2` onward, per `docs/REQ-TENANT-01.md`)
- `tenants` table: `id`, `slug`, `domain` (unique), `is_root`, `status`
  (active/suspended), `db_mode` (shared/dedicated — reserved, defaults
  shared), `created_at`. Exactly one tenant has `is_root = true`, matching
  `ROOT_TENANT_URL`; its admin is the system admin.
- `www.<domain>` and `<domain>` always resolve to the same tenant row —
  never create separate tenants for the two.
- Sub-communities (`sub1.baseurl`) are explicitly out of scope for
  REQ-TENANT-01 — unrecognized subdomains 404 like any other unrecognized
  domain, no special-casing.
- Tenant scoping enforcement point is the Prisma Client Extension, not
  individual services or controllers.

**Design note carried over from v1 (this needs an actual fix in `v2-2`/`v2-3`,
not another workaround):** v1 runs `BASE_DOMAIN=www.dinnerbears.com` in prod
because `www` is genuinely the only public web host — the apex publishes MX
only, no A record. The same value doubles as the auth cookie domain, which
means a subdomain like `cincinnati.dinnerbears.com` is a *sibling* of the
cookie domain rather than a child, so sessions don't carry to city
subdomains. v1 left this alone (nobody used those subdomains, and changing a
live cookie domain strands old cookies for up to 7 days) — v2 can't leave it
alone in the same way, since tenants *are* domains under the new model and
this exact www/apex/cookie-scope interaction will recur for every tenant
domain, not just one.

## Bug-Driven Development Workflow

When asked to work on bugs, Claude Code should:

1. Call `GET /api/v1/admin/feedback/open-bugs` to retrieve all open bug tickets
2. Present the list to Rob and ask which to work on
3. Implement the fix
4. Call `PATCH /api/v1/admin/feedback/:id/status` with `{status: "resolved"}` on the fixed ticket
5. Add an admin note via `POST /api/v1/admin/feedback/:id/notes` summarizing what was changed

## Branching & Release Workflow

v1's phase-based workflow (`/phase-start`/`/phase-testing`/`/phase-done`/
`/release`, `PHASES.md`, publishing to `:stage`/`:latest`) lives in the old
repo, not here — see the intro for why those commands were removed from
this repo rather than kept for reference. This repo uses its own v2 scheme:

| Command | Does | Touches `main`? |
| --- | --- | --- |
| `/v2-start <N>` | Cuts a `v2-<N>-<slug>` branch off `main` | No |
| `/v2-testing <N>` | Pushes the **unmerged** branch to the `v2-stage` image + gives Rob testing notes | No |
| `/v2-done <N>` | Docs (`V2_PHASES.md`, `docs/NEXT_RELEASE_V2.md`), tag `v2-<N>`, merge to `main`, re-stamp `v2-stage` | Yes |

Branch naming: `v2-<number>-<kebab-case-slug>`, e.g. `v2-1-prisma-swap`.
Tags: `v2-<number>`. Docker: `rtippenhauer/community-events:v2-stage`, built
by `scripts/publish-v2-stage.sh` — the only publish script in this repo.
There is no v2 prod tag yet; that's created at the actual 2.0 cutover, not
before.

Bug fixes and other ad hoc work that aren't tied to a v2 item still need a
branch, not a direct commit to `main` — reuse the current item's branch if
one is in progress, otherwise create a short-lived `bugfix-<slug>` or
`chore-<slug>` branch, merged via PR + real merge commit (never squash) once
ready.

**Versioning:** `package.json`'s version in this repo is still v1's
(`1.5.1`) and shouldn't be bumped as part of routine v2 work — there's no
`/v2-release` yet. `docs/NEXT_RELEASE_V2.md` accumulates a running draft of
v2's customer-facing changes via `/v2-done`; Rob will hand-trim it into the
actual 2.0 release copy at cutover, likely by building a `/release`-style
command at that point rather than inventing the flow speculatively now.
