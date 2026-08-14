# CommunityEvents — Claude Code Project Context

*Formerly DinnerBears.com.* This repo (`rtippenhauer/CommunityEvents`) was
created specifically for the **CommunityEvents v2.0** rewrite — a genuinely
separate GitHub repository from the one where v1 DinnerBears is actively
developed and deployed (confirmed with Rob 2026-08-09). This repo's `main`
started as a snapshot of the v1 codebase (Angular/NestJS/TypeORM/MySQL,
through v1 Phase 38, `package.json` v1.5.1) and is being progressively
replaced as v2 items land — `v2-1` has already swapped the data layer to
Prisma, so `main` is no longer a pure v1 snapshot. That inherited code is
**not** actively maintained here. Full v1 history, phase docs, and ongoing v1 fixes live in the old
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

**Current v2 work item:** `v2-5` — tenant-scoping Prisma Client Extension
(REQ-TENANT-01.3, second half): auto-inject `tenant_id` into `where` clauses
and set it on create, now that middleware resolves a tenant per request for it
to scope against. See `V2_PHASES.md` for the full backlog and each item's
Definition of Done.

**Completed v2 items:**
- **`v2-1` — Prisma data layer** (2026-08-09). TypeORM removed entirely:
  entities deleted, `typeorm`/`@nestjs/typeorm` uninstalled, all 36 services
  converted. `schema.prisma` is the single source of truth and one initial
  migration replaces the 84 inherited TypeORM migrations.
- **`v2-2` — Testing stack swap** (2026-08-11). Jest, ts-jest, Karma and
  Jasmine uninstalled; Vitest everywhere, Playwright scaffolded. API unit 76,
  API integration 623 across 28 files, frontend 91, Playwright 2.

  Worth knowing beyond the tooling: `v2-1` had left all 28 e2e specs
  uncompilable, so nothing had ever exercised the Prisma conversion. Restoring
  them found four defects live on `v2-stage` — BigInt from raw queries, a
  `delete()` that threw where TypeORM no-opped, an audit-log filter on a
  non-existent relation, and event DATE/TIME columns serialised as ISO
  timestamps — plus `import * as sanitizeHtml` being called as a function,
  which only worked because tsc emits CommonJS. Details in `V2_PHASES.md`.
- **`v2-3` — Tenants table** (2026-08-12). `tenants` table added; the root
  tenant is created by `bootstrap.ts` (not `seed.ts` — its domain is
  deployment-specific), and its domain defaults to `APP_URL` so stage and prod
  still differ by one value.

  Two invariants are enforced by the database rather than by convention, since
  both are security-shaped: exactly one `is_root` tenant (via a unique index on
  a nullable `root_marker`, because MySQL has no partial unique index), and a
  `domain` column that cannot physically hold a `www.` prefix. Also fixed a
  fourth P2025 regression here — five unguarded `update()` calls in scheduled
  tasks.
- **`v2-4` — Domain resolution middleware** (2026-08-14). `TenantMiddleware`
  runs ahead of every route and attaches the resolved tenant to the request;
  `TenantResolutionService` looks it up behind a short-TTL, size-bounded
  in-memory cache that also caches misses (the key is an attacker-controlled
  `Host` header).

  Three outcomes are kept distinct rather than collapsed into one 404, because
  they look identical to a visitor and mean opposite things to whoever fixes
  them: unrecognized host -> 404 `TENANT_NOT_FOUND`; no tenants at all -> 503
  `TENANT_NOT_CONFIGURED` plus a loud log (closing the gap `v2-3` left);
  suspended tenant -> 503 `TENANT_SUSPENDED`. Health is exempt, always answers,
  and reports which of those happened in a new `tenant` field — which paid off
  on the first stage deploy, where one curl found a root-tenant row still
  holding the pre-move `communityevents.rtippenhauer.com` domain.

  Two traps worth not re-discovering: **Nest mounts module middleware at a
  path and Express strips it**, so `req.path` is `/` for every request and only
  `req.originalUrl` survives intact; and **middleware cannot rely on
  `GlobalExceptionFilter`**, which wraps route handlers only — a thrown
  exception unwinds to Express's stock HTML error page, so the middleware
  writes its JSON body directly.

**Infra readiness (confirmed by Rob 2026-08-09):**
- A dedicated `communityevents` database + `communityevents_user` exist on
  the Unraid MySQL server (192.168.2.241), separate from `dinnerbears`.
- **Stage now lives at `https://stage.communityeventsproject.com`** — the
  project's own domain, replacing the earlier
  `communityevents.rtippenhauer.com`. Per REQ-TENANT-01.7 this deployment is
  its own root tenant, not a tenant of production.
- The full v2 fresh-install sequence has been run against it successfully:
  `prisma migrate deploy` (on container start) -> `seed.js` -> `bootstrap.js`.
  That is the supported install path from `v2-1` onward; the v1-era
  `typeorm migration:run` no longer exists.
- `rtippenhauer/community-events:v2-stage` carries the `v2-1` work. Note the
  image is built from the **working tree**, not from git, so never build with
  uncommitted changes and never with a CRLF checkout of `docker/entrypoint.sh`
  (`.gitattributes` now pins `*.sh` to LF — a CRLF shebang makes the container
  restart-loop with a misleading "not found").

V2 is being defined through a sequence of requirements docs. Only one exists
so far: **`docs/REQ-TENANT-01.md` — Tenant Foundation** (status: Draft;
`v2-1` through `v2-4` are implemented, `v2-5`/`v2-6` are outstanding). It is
the foundational doc everything else depends on and defines the conventions the
rest of v2 follows. Key decisions it locks in:

- **Prisma replaces TypeORM entirely** (not incrementally) — `schema.prisma`
  becomes the single source of truth, TypeORM removed once Prisma is
  confirmed working end-to-end against the existing schema.
- **Tenant isolation via a single Prisma Client Extension** that
  auto-injects `tenant_id` into `where` clauses and auto-sets it on create
  for tenant-scoped models — not left to individual services to remember.
  Global (non-tenant-scoped) models are excluded by explicit convention.
- **Domain-based tenant resolution** (landed by `v2-4`): NestJS middleware
  resolves `tenant_id` from the `Host` header before route handlers run, with
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
- **Testing stack changes** (REQ-TENANT-01.6, landed by `v2-2`): Vitest +
  Supertest for unit/integration, Playwright for e2e — replacing the
  inherited codebase's Jest (`api/`) and Karma/Jasmine (`frontend/`).
  A full replacement like the Prisma swap, not a side-by-side migration.

Required build order (foundational tooling first, then the data layer —
which has to exist before there's anything to scope): Prisma swap → testing
stack swap → tenants table → domain resolution middleware → tenant-scoping
Client Extension → bootstrap/runtime config split + user tenant scoping, in
that order — tracked as `v2-1` through `v2-6` in `V2_PHASES.md`. The testing
stack swap sits at `v2-2`, deliberately ahead of all tenant feature work, so
tenant code is written against Vitest from the start rather than ported off
Jest later (decided with Rob 2026-08-09; this shifted the old `v2-2`–`v2-5`
each up by one, and no `v2-*` tags existed yet). Full requirement-level
detail lives in `docs/REQ-TENANT-01.md`.

Not yet decided/known: whether the frontend framework itself is changing.
(Its testing choice is settled — `v2-2` put it on Vitest via Angular's
`unit-test` builder.)

**Domain scheme — decided 2026-08-09** (REQ-TENANT-01.7): the project owns
`communityeventsproject.com`. `www.` (and the apex, same tenant row) is the
root/system-admin tenant and the public landing page; other tenants are
subdomains; `stage.` is a separate deployment that is its own root tenant, not
a tenant of prod. Auth cookies must be scoped to the exact tenant host —
scoping them to the apex would share one session across every tenant. See
V2_PHASES.md's "Deferred: CommunityEvents domain, branding and demo" for the
backlog items (branding defaults, landing page, demo tenant), all deliberately
held until the tenant work is stable.

## Stack (current `main`)
Mostly the inherited v1 snapshot, with the data layer already replaced by
`v2-1`. The rest will be replaced piece by piece as v2 items land — do not
assume everything here is the target architecture.
- **Frontend:** Angular 22, standalone components (NO NgModules), Angular Material (MDC), SCSS
- **Backend:** NestJS (Node.js, TypeScript), **Prisma 7**, Passport.js
- **Database:** MySQL (stage runs 9.7 — the v1-era "8.x" note was wrong)
- **Auth:** JWT sessions + Google OAuth + Facebook OAuth (Passport strategies)
- **Email:** Brevo SDK (primary) + Resend (overflow fallback)
- **Push:** Web Push API with VAPID keys (@angular/pwa service worker)
- **Proxy:** NGINX Proxy Manager (Docker)
- **Containers:** Docker Compose — api and mysql have NO public ports
- **Testing:** Vitest everywhere (landed in `v2-2`). `api/` runs two configs —
  `vitest.config.mts` for unit specs under `src/`, `vitest.config.e2e.mts` for
  the 28 Supertest suites in `api/test/`. `frontend/` runs Angular's own
  `@angular/build:unit-test` builder with `runner: "vitest"`. Browser-level
  e2e is Playwright, at the repo root in `e2e/`. Jest, ts-jest, Karma and
  Jasmine are uninstalled.

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
├── e2e/                       ← Playwright browser e2e (root-level: spans both workspaces)
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
- **Prisma for all data access** (landed in `v2-1`). TypeORM is gone —
  there are no entities and the packages are uninstalled. Raw SQL via
  `$queryRaw`/`$executeRaw` is acceptable only where Prisma genuinely cannot
  express the statement, and every such site in the codebase carries a comment
  saying why (correlated subqueries, `ON DUPLICATE KEY UPDATE`,
  `COALESCE(resolved_at, NOW())`, `TIMESTAMP(date, time)` window filters).
- **Global prefix** `/api/v1` set in main.ts
- **Never expose stack traces** — GlobalExceptionFilter handles all errors
- **Tenant scoping is automatic, not manual** (from `v2-5` onward) — rely on
  the Prisma Client Extension rather than adding `tenant_id` filters by
  hand in services once it exists

## Database
MySQL via **Prisma 7**. `api/prisma/schema.prisma` is the single source of
truth; `docs/DATABASE_SCHEMA.md` is now human-readable reference only, not
authoritative (per REQ-TENANT-01.3).

- **Migrations:** `prisma migrate dev` locally, `prisma migrate deploy` in the
  container entrypoint. The 84 inherited TypeORM migrations are gone, replaced
  by a single init migration — v2 starts from a blank database and imports
  production data separately.
- **Fresh install is three steps:** `prisma migrate deploy` (automatic on
  container start) -> `node dist/database/prisma/seed.js` (reference data:
  achievements, app_config defaults, avatars, cities, automation account) ->
  `node dist/bootstrap.js` (this operator's city, branding and first admin).
  Seed before bootstrap: bootstrap edits seeded data, so running it first
  leaves the DinnerBears bear avatars and terminology in place.
- **Prisma 7 specifics:** no `url` in the schema's datasource block — the
  connection string lives in `prisma.config.ts` (derived from the existing
  `DB_*` vars) and the client takes a driver adapter,
  `@prisma/adapter-mariadb`, which is the MySQL adapter despite the name.
- **`allowPublicKeyRetrieval` is required**, not optional. MySQL 8/9 use
  `caching_sha2_password`, and over a non-TLS connection the driver must fetch
  the server's RSA public key to complete a first-time handshake. Without it
  every query fails as a "pool timeout" that never mentions authentication.
- **Field naming:** scalar fields are camelCase with `@map` to their
  snake_case columns, and relation fields carry the old entity property names.
  This is deliberate — controllers return rows straight to the client, so a
  field name here IS the JSON key the frontend consumes.
- **Four `locations` columns are hidden by a global `omit`** in
  `PrismaService` (`moderatorNotes`, `contactName`, `contactPhone`,
  `contactEmail`), standing in for TypeORM's `select: false`. Only
  `findOneWithModFields` opts back in. Prisma returns every scalar by default,
  so a new query is safe only because the omit is global.
- **DATE/TIME columns come back as `Date`**, where the entities typed them as
  strings. `api/src/common/utils/prisma-date.util.ts` converts both ways; use
  it rather than string-slicing a Date.

## Multi-Tenancy (per `docs/REQ-TENANT-01.md`)
- **`tenants` table exists as of `v2-3`**: `id`, `slug`, `domain` (unique),
  `is_root`, `root_marker`, `status` (active/suspended), `db_mode`
  (shared/dedicated — reserved, defaults shared), `created_at`, plus four
  reserved OAuth credential columns (nullable; the two `*_secret` ones must be
  encrypted at rest before anything writes them).
- Exactly one tenant has `is_root = true`; its admin is the system admin. This
  is a **database constraint**, not a convention: `root_marker` is `true` on the
  root and NULL elsewhere, and its unique index rejects a second root (MySQL has
  no partial unique index, but permits repeated NULLs in a unique one). Write
  `is_root` and `root_marker` together, always.
- `domain` is stored bare and lower-cased and **cannot hold a `www.` prefix** —
  `normalizeTenantDomain` strips it on the way in, so `www.<domain>` and
  `<domain>` cannot become two rows. Use that same function for any Host-header
  lookup; seeding and resolution must not drift.
- The root tenant's domain comes from `ROOT_TENANT_URL` if set, else `APP_URL`
  (`resolveRootTenantDomain`). **Not** `BASE_DOMAIN` — that is the mail domain.
- The root tenant is created by `bootstrap.ts`, so a database that is migrated
  and seeded but not bootstrapped has **no tenant at all**. As of `v2-4` domain
  resolution fails loudly on that (503 `TENANT_NOT_CONFIGURED` + an error log)
  rather than 404ing every request.
- `bootstrap.ts` writes the root tenant with `ON DUPLICATE KEY UPDATE domain =
  VALUES(domain)`, so **re-running it overwrites the domain from `APP_URL`**.
  That self-heals a wrong domain, but a stale `APP_URL` silently reverts a
  manual fix — which is exactly how stage came up unresolvable on the `v2-4`
  deploy.
- Sub-communities (`sub1.baseurl`) are explicitly out of scope for
  REQ-TENANT-01 — unrecognized subdomains 404 like any other unrecognized
  domain, no special-casing.
- **Host-header resolution landed in `v2-4`** (`api/src/common/tenant/`).
  `TenantMiddleware` runs ahead of every route and sets `req.tenant`
  (`TenantContext`: id, slug, domain, isRoot, status); read it rather than
  re-resolving. `TenantResolutionService.resolve()` never throws — an unknown
  host is an outcome, not an error — and caches results, misses included, on a
  short TTL with a 500-entry ceiling.
- **Adding a route that must answer without a tenant means editing
  `UNSCOPED_PATHS`** in `tenant.middleware.ts`. Only `/api/v1/health` is in it.
  The exemption is a string compare against `req.originalUrl`, not
  `MiddlewareConsumer.exclude()`, because a wrong exclude pattern fails open —
  every route unscoped, silently.
- **Middleware cannot use `GlobalExceptionFilter`**: it wraps route handlers, so
  an exception thrown in middleware unwinds to Express's stock HTML error page
  instead. `TenantMiddleware` writes its JSON body directly, matching the
  filter's shape. Its `reason` values (`TENANT_NOT_FOUND`,
  `TENANT_NOT_CONFIGURED`, `TENANT_SUSPENDED`) are a contract the frontend reads
  to decide whether to show the holding page — don't rename them on one side.
- **Nest mounts module middleware at a path and Express strips it**, so
  `req.path`/`req.url` are `/` inside any middleware registered via
  `forRoutes()`. Use `req.originalUrl`.
- Tenant scoping enforcement point is the Prisma Client Extension, not
  individual services or controllers.

**Design note carried over from v1 (still unfixed after `v2-3`/`v2-4` — those
built tenant identity and resolution, not cookie scoping, so this now belongs
to `v2-6`'s auth work):** v1 runs `BASE_DOMAIN=www.dinnerbears.com` in prod
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
