# CommunityEvents v2 — Work Item Breakdown

Plays the same role `PHASES.md` plays in the old (v1) repo, scoped to the v2
rewrite (multi-tenant, Prisma) in this repo. Items are `v2-<N>`, cut via
`/v2-start <N>` — this repo doesn't continue v1's phase numbering (1–38) or
carry its phase tooling; see CLAUDE.md's intro for why.

Backlog below is seeded from `docs/REQ-TENANT-01.md`'s required build
order (data layer has to exist before there's anything to scope). Update
each item's status as `/v2-done` closes it; add new items here as later
requirements docs (REQ-TENANT-02, …) land.

## v2-1 — Prisma data layer (REQ-TENANT-01.3, first half)
**Status:** Complete (2026-08-09)

Install Prisma, model `schema.prisma` against `docs/DATABASE_SCHEMA.md` as
a starting point, wire up `PrismaService` in place of `TypeOrmModule`,
remove TypeORM entities/decorators and `@nestjs/typeorm` once everything
compiles against Prisma. Confirm end-to-end (app boots, existing queries
run) before moving on. Tenant-scoping extension is deliberately **not**
part of this item — see v2-5.

**Definition of done:** TypeORM fully removed; Prisma is the only
data-access layer; app boots and existing queries run against it.

**Outcome:** met in full. All 36 services converted, the 37 entity files
deleted and `typeorm`/`@nestjs/typeorm` uninstalled. `events` and `auth` were
briefly deferred to `v2-2` on the grounds that they hold the most
authorization logic and there were no tests to catch a regression; that call
was reversed and both were converted here, so the item closes against its
original definition.

Verified on stage: `prisma migrate deploy` -> `seed.js` -> `bootstrap.js` on a
blank database, app serving. **Not** verified: anything behind authentication,
since the item ships with no test coverage — which is exactly what `v2-2`
addresses next.

## v2-2 — Testing stack swap (REQ-TENANT-01.6)
**Status:** Complete (2026-08-11)

Replace Jest (`api/`) and Karma/Jasmine (`frontend/`) with Vitest across
both workspaces, keep Supertest for API integration tests, and scaffold
Playwright for e2e. Port the inherited suites rather than dropping them; any
suite too tied to Jest/Karma internals to port cheaply gets called out
explicitly instead of silently deleted. Sequenced here — immediately after
the Prisma swap, before any tenant feature work — because it's the same kind
of foundational tooling replacement, and doing it now means all tenant code
is written under the target stack from its first line.

**Definition of done:** Jest and Karma/Jasmine fully removed; Vitest is the
only test runner; Playwright wired up with a passing smoke spec; inherited
suites pass under Vitest or their removal is explicitly noted.

**Outcome:** met in full, and no inherited suite was dropped. Final counts:
API unit 76 (was 11), API integration 623 across 28 files, frontend 91,
Playwright 2. The frontend runs on Angular 22's own `@angular/build:unit-test`
builder with `runner: "vitest"` rather than a hand-rolled Vite config.

The item turned out to be worth more than the tooling swap. `v2-1` had left
all 28 e2e specs uncompilable, so nothing had exercised the Prisma conversion;
restoring them became the retrospective verification that item never got, and
surfaced four real defects already live on `v2-stage`:

- raw `$queryRaw` results hand integer columns back as **BigInt**, which broke
  the leaderboard, the member directory, the ratings list, the invite backfill
  and the reservation sweep — either inside Prisma or inside `JSON.stringify`
- `PATCH /admin/points/:id/remove` threw P2025 where TypeORM's `delete()`
  had no-opped
- the admin audit log's user search filtered on a relation that does not exist
- `events.event_date`/`event_time` were serialised as ISO timestamps instead of
  the date-only/time-only strings the client parses, so events displayed a day
  early and the new-event form defaulted to a nonsense time

A fifth, `import * as sanitizeHtml` being called as a function, only ever
worked because tsc emits CommonJS; it threw the moment the code ran as real
ESM under Vitest.

Each fix carries a regression test, verified to fail against the unfixed code.
The suite had passed 620/620 while the event date format was wrong, because
nothing asserted the shape of those two fields — which is the argument for the
unit leg this item also filled in.

## v2-3 — Tenants table (REQ-TENANT-01.1)
**Status:** Complete (2026-08-12)

Add the `tenants` table and seed the root tenant, now that Prisma is the
working data layer.

**Definition of done:** `tenants` table exists with root tenant seeded on
first run.

**Outcome:** met. The table carries the columns REQ-TENANT-01.1 lists plus the
four reserved OAuth credential columns; the root tenant is created by
`bootstrap.ts`, not `seed.ts`, because its domain is deployment-specific.

Three decisions worth carrying forward:

- **"Exactly one root" is a database constraint, not a convention.** MySQL has
  no partial unique index, but it permits repeated NULLs in a unique one, so
  `root_marker` is `true` on the root tenant and NULL elsewhere. Verified
  against MySQL directly before relying on it. A second root tenant would mean
  a second system admin.
- **`domain` cannot physically hold a `www.` prefix.** `normalizeTenantDomain`
  strips it on the way in, and v2-4's Host-header middleware calls the same
  function, so seeding and resolution cannot drift.
- **The root domain defaults to `APP_URL`** rather than requiring
  `ROOT_TENANT_URL`, so stage and prod still differ by one value. `IS_STAGE`
  was considered and rejected: it is a behavioural flag, and deriving a
  hostname from it would hardcode a `stage.` prefix convention while coupling
  stage's identity to production's apex — the exact thing REQ-TENANT-01.7 says
  stage is not.

Known gap for v2-4: a database that has been migrated and seeded but not
bootstrapped has no tenant at all. Domain resolution should fail loudly on
that rather than 404 every request.

Also fixed here, found by the e2e suite hanging rather than failing: five
unguarded `prisma.update()` calls in scheduled tasks, a fourth instance of the
v2-1 P2025 family (TypeORM's `update()` no-opped on a missing row; Prisma's
throws). In a cron there is no request to surface that on, so it became an
unhandled rejection.

## v2-4 — Domain resolution middleware (REQ-TENANT-01.2)
**Status:** Complete (2026-08-14)

NestJS middleware resolving `tenant_id` from `Host` header, built against
the now-existing tenants table.

**Definition of done:** Domain resolution middleware correctly resolves
tenant from `Host` header for root domain, `www.` variant, and returns 404
for unrecognized domains.

**Outcome:** met. `TenantMiddleware` runs ahead of every route and attaches the
resolved tenant to the request; `TenantResolutionService` does the lookup
behind a short-TTL in-memory cache. Lookups go through `normalizeTenantDomain`,
the same function bootstrap uses to write the root tenant's domain, so the
`www.`/bare equivalence holds by construction rather than by both sides
remembering to strip the prefix.

Three outcomes are deliberately distinguished rather than collapsed into one
404 — the distinction is the whole value, since all three look identical to a
visitor and mean completely different things to whoever has to fix them:

- unrecognized host -> 404 `TENANT_NOT_FOUND`
- no tenants at all -> 503 `TENANT_NOT_CONFIGURED` plus a loud log. This closes
  the gap v2-3 flagged: a database migrated and seeded but never bootstrapped
  would otherwise 404 every request and look like a DNS mistake rather than an
  unfinished install.
- suspended tenant -> 503 `TENANT_SUSPENDED`. Not in the Definition of Done,
  but `status` existed with nothing reading it and serving a suspended tenant
  normally was the only worse option.

Health is exempt and always answers, reporting the outcome in a new `tenant`
field. An unrecognized host leaves `status: ok` — the app is fine, the address
is wrong — while an unbootstrapped deployment is `degraded`, since nothing else
reports it. This earned itself immediately: stage came up `tenant:
"unrecognized"` on first deploy, and one curl identified a root-tenant row
still holding the pre-move `communityevents.rtippenhauer.com` domain.

Two things only a real HTTP stack revealed, both worth remembering:

- **Nest mounts module middleware at a path, and Express strips the mount path
  from `req.url`/`req.path`.** Under `forRoutes('{*splat}')` every request
  reports its path as `/`, so the health exemption silently matched nothing.
  `req.originalUrl` is the only field that survives mounting intact. The unit
  spec now builds fake requests the way Express really presents them, so it
  cannot pass while reality fails.
- **Middleware cannot rely on `GlobalExceptionFilter`.** A filter registered
  with `useGlobalFilters()` wraps route handlers; an exception thrown in
  middleware unwinds to Express's own handler, which keeps the status but
  replaces the body with stock HTML. The `reason` is what the frontend reads to
  choose the holding page, so the middleware writes its body directly.

The cache keys on an attacker-controlled `Host` header, so it caches negative
results (or unknown hosts are a database query each) and is bounded at 500
entries (or it grows without limit).

Frontend half: nginx serves the Angular app and knows nothing about tenants —
it only proxies `/api` — so an unrecognized host still gets the SPA shell and
simply cannot load any data. A `tenantInterceptor` watches every failed
response for those `reason` values and records them, and `AppComponent` swaps
the entire shell for a self-contained holding page. Deliberately unbranded:
branding is per-tenant runtime config, and on a host with no tenant there is
nothing to read it from. This is the holding page, not the marketing one — v2-10
replaces what it says, not how it is triggered.

`truncateAllTables` now re-seeds the tenant ordinary requests resolve against,
with a pinned id so a cached resolution still describes the row that exists
after a truncate. Without it all 28 inherited suites would have been running
against a deployment with no tenants.

**Follow-up for whoever next touches deployment:** `bootstrap.ts` writes the
root tenant with `ON DUPLICATE KEY UPDATE domain = VALUES(domain)`, so it
overwrites the domain from `APP_URL` on every run. That self-heals a wrong
domain, but it also means a stale `APP_URL` silently reverts a manual fix.

## v2-5 — Tenant-scoping Prisma Client Extension (REQ-TENANT-01.3, second half)
**Status:** Complete (2026-08-14)

Add once v2-1 and v2-3 are both confirmed working — easier to verify
scoping against a known-good baseline than to build both at once.

**Definition of done:** Tenant-scoping Prisma extension verified via
integration test (cross-tenant data leakage impossible even with colliding
IDs).

**Outcome:** met. `tenant_id` on 27 transactional models, 12 left global, with
the split declared once in `tenant-scoped-models.ts` and made exhaustive over
`Prisma.ModelName` at the type level — adding a model without classifying it
does not compile. The extension injects the filter on reads, creates and
destructive writes, and walks nested writes, nested `include`/`select`,
relation counts and `connect` off the DMMF, because a query can reach tenant
data without naming a scoped model at the top level. Tenant travels by
AsyncLocalStorage from `TenantMiddleware`; the extended client is bound to the
`PrismaService` token, so all 40 injection sites were untouched and the
unscoped client is not reachable.

Verified by `test/tenant-isolation.e2e-spec.ts` — two tenants on one client,
asserted at the Prisma level and over HTTP on two hosts, with fixtures
interleaved so neither tenant owns a contiguous id range (a missing filter
would return the wrong tenant's row rather than nothing, so the negative
assertions cannot pass vacuously). Suite totals: unit 146, e2e 670 across 31
files.

Five things worth carrying forward:

- **Fails closed in three independent ways.** No context throws; `tenant_id`
  carries a sentinel `DEFAULT 0` the foreign key rejects, so anything escaping
  the extension dies at the database rather than writing an orphan; and the
  four `@Cron` sweeps carry explicit `runUnscoped('<reason>')` waivers.
- **The extension cannot see raw SQL**, which Prisma does not route through
  extensions. All raw statements in service code were audited: 14 gained a
  predicate, 4 are documented as not needing one.
- **Prisma promises are lazy**, so `runWithTenant(id, () => prisma.x.find())`
  builds the query inside the context and runs it outside. Production call
  shapes are safe; it bit the test helpers. Documented on `runWithTenant`.
- **Prisma rejects `where` on a to-one `include`** outright, so only to-many
  relations can be filtered; to-one hops rely on the foreign key instead.
- **Vitest runs every hook and test body in a sibling async context**, so
  neither `run()` nor `enterWith()` from a setup file reaches an `it()`. Hence
  the NODE_ENV-gated test fallback rather than editing 28 spec files.

Also fixed here: `member_achievements` and `member_points` keyed their unique
indexes on globally-unique ids, so one community granting a member an
achievement permanently blocked another from doing the same. And a regression
this item introduced — `HardDeleteTask`'s audit write began failing the new
foreign key, silently, because the task catches its own errors; system audit
entries are now attributed to the root tenant.

Beyond the Definition of Done, this item also carries operator tooling added
for testing it: `provision-tenant.ts`, `seed-test-data.ts` and a conditional
`deploy-provision.ts` that makes seeding and bootstrapping safe to run
unattended on every container start.

**Not verified on stage.** `/v2-testing` was deliberately skipped: the item's
central property needs two tenants to observe, and tenant-scoped login (v2-6)
has to land before a second tenant on stage is testable. Its *regression*
surface — the 14 hand-edited raw SQL statements behind the member directory,
leaderboard, ratings and account deletion — is therefore unexercised outside
CI, and should be part of whatever stage pass v2-6 gets.

**Known gap this item deliberately leaves open — `users` is still global.**
Agreed with Rob 2026-08-13 when the item was scoped. 27 transactional models
gained `tenant_id`; `users` did not, because REQ-TENANT-01.5 (per-tenant email
uniqueness, auth resolving within the requesting tenant) is v2-6's stated
Definition of Done, and because `seed.ts` writes the automation account before
`bootstrap.ts` has created any tenant to attach it to. Until v2-6 lands:

- **Any account can authenticate against any tenant.** `AuthService` finds the
  user by email against the global `users` table, so a member of one community
  can log in at another's host and be issued a valid session there. That is the
  hole, and REQ-TENANT-01.5 is what closes it.

  A *session* does not carry across tenants, though — which is worth knowing
  before anyone designs around the gap being wider than it is. `JwtStrategy`
  validates by looking the `jti` up in `login_sessions`, and that table is
  tenant-scoped as of v2-5, so a cookie issued by one tenant produces a 401 on
  another rather than an authenticated request. Scoping that table bought this
  incidentally; it was not designed as an auth control and should not be relied
  on as one.
- Member-facing lists that anchor on `users` (the directory, the leaderboard)
  span tenants, even though each row's *scoped* data — points, achievements,
  linked providers — is filtered correctly.
- `notification_preferences.user_id` and `oauth_accounts (provider,
  provider_id)` are still globally unique, so a member can hold either in only
  one tenant. `member_achievements` and `member_points` had the same problem and
  were fixed here (their unique keys now include `tenant_id`), because both key
  off globally-unique ids and a write in one tenant would otherwise block
  another's; the two above were left alone as they are auth-shaped and belong
  with the rest of v2-6.

Anything seeded before bootstrap runs is global for the same ordering reason:
`cities`, `app_config`, `avatar`, `achievements`, `email_provider_config`,
`merch_config`. Reordering the install is v2-6's bootstrap/runtime-config split.

## v2-6 — Bootstrap/runtime config split + user tenant scoping (REQ-TENANT-01.4, REQ-TENANT-01.5)
**Status:** Complete (2026-08-19)

Last, since both depend on tenants existing and domain resolution working.

Confirmed with Rob 2026-08-14, after v2-5 landed with `users` still global:
**users cannot stay global — login must resolve against the tenant that owns
the URL it was submitted to.** That was already REQ-TENANT-01.5's intent; it is
recorded here because it is now also what blocks testing. A second tenant on
stage is not meaningfully testable until it lands.

Surveyed before starting, so the size is known rather than discovered:

- **109** `prisma.users.*` call sites; **14** lookups keyed on email across 9
  files. Making email unique per tenant breaks every
  `findUnique({ where: { email } })` at compile time, which turns the audit
  into a checklist rather than a hunt.
- **`ReleaseNotesImporterService` queries `users` from
  `onApplicationBootstrap`** — at startup, with no request and so no tenant
  context. The moment `users` is scoped this throws on every boot. Fail-closed
  working as designed, but it needs a waiver or root-tenant attribution the way
  `AuditService` got one. Left unhandled it is a restart loop on stage.
- **Install ordering has to change.** `seed.ts` writes the automation account
  from `users.json` before any tenant exists. Moving it into `bootstrap.ts` is
  the cleanest fix — bootstrap already creates the tenant *before* the admin, so
  the ordering is right there.
- **`oauth_accounts`** needs `(tenant_id, provider, provider_id)`, or one Google
  account can only ever link in a single community.
- `notification_preferences.user_id` becomes correct for free once a user
  belongs to exactly one tenant.
- The v1 cookie-scoping design note (see the end of this file's CLAUDE.md
  counterpart) belongs to this item's auth work.

Per-tenant OAuth *credentials* are explicitly **not** here — that is v2-8,
gated behind v2-7's encryption. Until then OAuth keeps using the platform env
credentials while resolving the user within the tenant, so stage does not
regress.

**Definition of done:** `users.tenant_id` enforced; duplicate email allowed
across tenants, blocked within a tenant; bootstrap config trimmed to
`DB_MODE`/DB connection/`ROOT_TENANT_URL`; `app_config` made tenant-aware.

### Landed so far in v2-6

**Boot-time landmine defused.** `ReleaseNotesImporterService` now resolves the
root tenant and looks the automation account up inside `runWithTenant`, so the
lookup keeps working the moment `users` becomes scoped. Root-tenant attribution
rather than a `runUnscoped` waiver: with email uniqueness becoming per-tenant,
an unscoped `findFirst` on the automation address would return whichever
tenant's account the engine reached first. A database that is migrated and
seeded but never bootstrapped logs and skips instead of failing the boot.

**Service accounts** (`users.is_service_account`, added 2026-08-15 with Rob).
Every tenant gets exactly one non-human account. Decided together: a column
rather than a check on the role or the fixed automation email, because both of
those move -- the role is deliberately mutable and the email is branding v2-9
rewrites.

They cannot be removed (ban, force-ban, admin delete, self-delete and the
hard-delete cron all refuse them) and are hidden from the member directory and
the leaderboard. The protection that mattered was the **inactivity sweep**,
which soft-deletes any ACTIVE account idle over 120 days and hard-deletes it 30
days later: a service account drifts into that window by design, and losing the
row would orphan every audit and release-notes FK pointing at it.

**`disabled` role.** No privileges at all -- RolesGuard is an allowlist, so it
matches no `@Roles()`. This is what non-root tenants' service accounts hold.
Rob's call, and it closes an escalation path: `setRole` deliberately permits
promoting an `automation` account to admin, so an `automation`-role account on
every tenant would have handed each tenant admin a route to admin.

**`system_admin` role + tenant management** (asked for 2026-08-15). Operator of
the deployment rather than of one community. `SystemAdminGuard` requires the
role **and** `req.tenant.isRoot`, so a `system_admin` row appearing on an
ordinary tenant grants nothing -- the host is not something a tenant admin can
change. `setRole` refuses to assign or remove the role at all.

`GET/POST/PATCH /api/v1/system/tenants` plus `/admin/tenants` in the UI. Four
rules the service enforces, all lockout- or escalation-shaped: no route can
create a root tenant; the root tenant cannot be suspended (middleware would 503
the request that would undo it); its domain cannot be changed here (bootstrap
rewrites it from `ROOT_TENANT_URL` each run, and the admin is browsing on it);
and there is no delete at all, since removing a tenant means removing every row
of the 27 scoped models referencing it.

Two things worth not re-deriving:

- **A role that implies another role leaks past the guard.** `RolesGuard` gained
  a one-level hierarchy (`system_admin` -> `admin`) to avoid editing ~50
  `@Roles(ADMIN)` sites whose failure mode would have been silent. But the guard
  only decides whether a request reaches a handler: ~25 in-code
  `role === UserRole.ADMIN` comparisons and ~20 more in the frontend ask the
  question again, and none of them knew about the hierarchy. Both sides now go
  through `hasAdminRights`/`isElevatedRole` helpers. The frontend copy is
  deliberately parallel rather than shared -- it types `role` as a plain string
  off the wire, so a mismatch is behaviour, not a compile error.
- **`err.meta.target` does not exist on a P2002 under `@prisma/adapter-mariadb`.**
  The constraint arrives at `meta.driverAdapterError.cause.constraint.index`.
  Matching on the index names pinned by `@unique(map:)` is what makes
  "that domain is taken" distinguishable from "that slug is taken".

**Automated deletion cannot reach a protected account** (agreed with Rob
2026-08-15). Every interactive delete path already refused admins and service
accounts; the scheduled sweeps did not, which made them the one actor that could
remove an admin with no confirmation and nobody watching. `inactivityCheck`
soft-deletes anything idle past 120 days and hard-deletes it 30 days later, so
the realistic loss was never the service account -- it was an operator who runs
a quiet community by email for four months and never signs in. `admin`,
`system_admin` and service accounts are now excluded from both deletion stages
(`AUTO_DELETE_ELIGIBLE`), while admins still receive the 60- and 90-day nudges:
being reminded is the point, being deleted on a timer is not.

**The schema change landed 2026-08-15.** `users` and `app_config` are scoped,
email is unique per tenant, `oauth_accounts` is re-keyed on
`(tenant_id, provider, provider_id)`. The two deferred items came with it:
bootstrap creates its first admin as `system_admin`, and every tenant gets its
service account (root `automation`, others `disabled`) from bootstrap,
provision-tenant or the create endpoint.

**Install ordering changed, because it had to.** `seed.ts` runs before any
tenant exists, so anything it writes to a scoped table takes the `tenant_id`
sentinel and is rejected by the foreign key. The `app_config` defaults and the
automation account moved to `bootstrap.ts`, which creates the tenant first.
Verified end to end against a fresh database: `migrate` -> `seed` ->
`bootstrap` yields a root tenant, a system admin, a service account and 31
scoped config rows; `provision-tenant` then adds a second tenant whose service
account holds the *same address* with role `disabled`.

Three things worth not re-deriving:

- **The compiler audited half the work and none of the risky half.** The 17
  compile errors were all "email no longer identifies a row", mostly
  `findUnique` -> `findFirst` so the extension injects the tenant instead of the
  caller naming it. The 11 raw SQL statements touching `users` produced no error
  at all, because Prisma does not route raw SQL through extensions -- those were
  the actual leak surface, and four of them (leaderboard, member directory, two
  achievement backfills) carried comments from earlier items saying they could
  not be filtered until `users` had a `tenant_id`.
- **Compound unique keys are the one place a service names the tenant.**
  `app_config`'s upserts cannot use the extension: Prisma spells a compound key
  as a single nested object it will not merge a separate `tenantId` into. Those
  use `requireTenantId`, the same escape hatch raw SQL uses.
- **Importing anything from a script runs the script.** `provision-tenant.ts`
  imported `createServiceAccount` from `bootstrap.ts`, and both call `main()` at
  the bottom of the file -- provisioning a tenant died on a missing
  `INSTANCE_CITY_NAME` it has no business needing. Anything shared between two
  entry points has to live outside both.

Two behaviour decisions taken here rather than discovered later: the Brevo
webhook updates **every** tenant's row for an address under an explicit
`runUnscoped` waiver (deliverability is a property of the address, the same
reason `email_suppressions` is global), and `automationLogin` requires both the
requesting tenant's account *and* role `automation`, so the single platform-wide
`CLAUDE_AUTOMATION_SECRET` cannot mint a session on a community the operator
does not run.

**Tenant-aware links, found during the v2-6 stage pass** (2026-08-16). Rob
asked whether email tokens were tenant-scoped. The *lookups* were — they go
through `findFirst` on `users`, so the extension injects the tenant. The
*links* were not: all 26 sites that build a user-facing URL read the single
`APP_URL` env var, so a member of a non-root tenant received a link to the root
host, where the scoped token lookup found nothing.

The scoping is what turned this from cosmetic into blocking. While `users` was
global the lookup succeeded whatever host you landed on; afterwards a
non-root tenant could not verify an address, reset a password or redeem an
invite at all — so it could not onboard a single real member, which is the
thing v2-6 exists to make testable.

`TenantResolutionService.baseUrlFor()` resolves a tenant's base URL (cached,
invalidated with the resolution cache, scheme from `APP_URL` since TLS is a
property of the deployment). All 26 sites converted.

Two things that were not find-and-replace:

- **The seats-reminder sweep was rendering with the wrong tenant's branding.**
  It runs under `runUnscoped` to find events across tenants, then composed each
  email in that same context — and `getEmailBrand` reads `app_config`, which
  v2-6 had just scoped, so `findFirst` returned whichever tenant the engine
  reached first. Fixed by re-entering `runWithTenant(event.tenantId)` around the
  loop body rather than threading an id through every helper, so later reads are
  correct too. **The general rule: `runUnscoped` is right for finding rows
  across tenants and wrong for rendering anything.**
- **The frontend redirected "unknown" hosts to `APP_URL`.** A v1 safety net for
  typo'd DNS, it would have bounced a legitimate tenant off its own site
  whenever that host was not also a city subdomain. Removed: the server already
  answers that question, and answers it better — an unrecognized host gets 404
  `TENANT_NOT_FOUND` and the holding page rather than a silent redirect into
  another community.

**Found by the first real two-tenant test on stage** (2026-08-16). Rob created a
second community at `stage.rtippenhauer.com`; it resolved and served correctly,
and then turned out to be a dead end.

- **A new community had no way in.** Creating a tenant made the tenant row and
  its `disabled` service account and nothing else. Registration requires an
  invite, invites must be issued by an existing member of that tenant, and the
  only "first user becomes admin" path is `ADMIN_EMAIL` + Google OAuth, which is
  single-host until v2-8. Tenant creation now takes the first admin's name,
  email and password and creates an active admin on the new community, the same
  way `bootstrap.ts` does for the root tenant. The fields are create-only:
  editing a community must not mint a second admin.
- **Not being able to sign in to tenant 2 with the root tenant's account is
  correct** and is the property v2-6 exists to produce. Recorded because it
  looks like a bug from the outside.
- **`automationLogin` had a regression of this item's own making.** It required
  the account to hold role `automation`, which broke the documented workflow of
  flipping that account up to `admin` to browse role-gated pages — the flip made
  automation login start refusing. It now keys on `is_service_account` plus the
  account's tenant being root, which is the rule the rest of v2-6 follows: never
  key on the role, because the role is the one property guaranteed to move.
- **`system_admin` is assignable from the UI for the root tenant's service
  account only** (agreed with Rob for live testing). A human still cannot be
  promoted; bootstrap creates the first system admin and any further one is a
  database edit. **Expected to revert to database-only before production** —
  when that happens, delete the block in `admin.service.setRole` and the
  role-picker entry in `member-profile.component.ts`; nothing else depends on it.
- **express-session is gone.** It printed a MemoryStore production warning on
  every boot while doing nothing: `GoogleStrategy` never sets `state: true`, so
  `passport-oauth2` selects its `NullStore` (empty `store`/`verify`) and never
  touches `req.session`, and nothing else in the application read it. Worth
  knowing that `NullStore.verify()` returns true unconditionally, so the OAuth
  `state` was *already* unverified — the open-redirect guard stands in for it
  until REQ-TENANT-01.8's signed state lands in v2-8.
  The package is uninstalled and `SESSION_SECRET` is gone from
  `test/setup-env.ts`, `docs/NEW_INSTANCE_SETUP.md` and the Unraid template;
  nothing reads it, so an existing `.env` can keep or drop it freely.
  `test/utils/test-app.ts` mounted its own copy and no longer does, so the test
  app still matches `main.ts` middleware for middleware.

### Bootstrap vs. runtime config (REQ-TENANT-01.4), 2026-08-16

The requirement is one sentence -- bootstrap config shrinks to the database
connection plus `ROOT_TENANT_URL`, everything else becomes tenant-aware runtime
config -- and the work turned out to be mostly *deciding*, not moving. Which of
the operator-settable variables is which was written down nowhere, so the answer
was being re-derived from `.env.example` comments each time it came up.

**The classification is now declared once**, in
`api/src/common/config/env-classification.ts`, one entry per variable with the
reasoning: `bootstrap`, `install`, `deployment`, `runtime`, or
`secret-pending-v2-7`. `env-classification.spec.ts` holds it to `.env.example`
in both directions -- a variable added to the sample env without a
classification fails, and a classification whose variable no longer exists
anywhere fails too. Same property as `tenant-scoped-models.ts`: you cannot add
one without saying which kind it is.

Three things fell out of writing it:

- **Bootstrap config was already small** -- eleven variables, all of them
  genuinely unable to live in the database, because they are how the process
  reaches the database or finds the root tenant in it. `JWT_SECRET` is in the
  list for a reason worth stating: verifying a session token happens *before*
  the request is scoped, so a per-tenant signing key could not be told apart
  from a forgery until after the tenant had been read out of the token.
- **`DB_MODE` does not exist.** REQ-TENANT-01.4 names it as bootstrap config and
  nothing ever implemented it; the `tenants.db_mode` *column* is the reserved
  shared/dedicated marker from REQ-TENANT-01.1 and is a different thing. Left
  unimplemented rather than invented, since nothing reads either one yet.
- **Seventeen variables were documented nowhere** -- not in `.env.example`, not
  in the setup guide, not in the Unraid template. `AUTO_PROVISION` was one of
  them, which is why the first stage install needed Rob to be told about it out
  of band. They are all in `.env.example` now, grouped by class.

**What actually moved: contact identity.** The addresses a community puts on
outbound mail and calendar entries (`hello@`, `calendar@`, `noreply@`) were
derived from one deployment-wide `BASE_DOMAIN`, so a second community signed its
.ics files with the first one's address. Four new `app_config` keys --
`mail_domain`, `contact_support_email`, `contact_calendar_email`,
`contact_event_email` -- make them per-community, editable in Site Settings.

Resolution is most-specific-first: the community's explicit address, else a
derivation from the community's own mail domain, else the deployment env var,
else a derivation from the deployment's domain. **Step two sits above step
three deliberately** -- a community that named its own mail domain has said
something more specific than the deployment default. Everything defaults to
blank, so an install that never opens the page behaves byte-identically; that
matters because these are the reply-to on real mail.

**The mail domain is NOT derived from the tenant's own host**, which is the trap
worth not re-discovering. A tenant is a web host and tenants below the apex are
subdomains, and `dayton.example.com` normally publishes no MX record -- deriving
`hello@dayton.example.com` would produce an address that bounces silently. It is
the same failure the `www.` strip in `instance-contact.ts` already guards, one
level down. A community whose subdomain really does take mail says so
explicitly.

**The mail domain is asked for when the community is created**, not only in
Settings afterwards. Rob's point (2026-08-16): the operator creating a community
is the only person who knows the DNS behind it, and the field is useless to the
one person who cannot see it. `CreateTenantDto.mailDomain` writes an ordinary
`mail_domain` row on the new tenant -- the same setting its own admin sees
later, not a second place the value lives. Blank stays unwritten, because blank
means "inherit" and that is resolved at read time.

The dialog **suggests** the deployment's own mail domain when the new community
sits beneath it -- `dayton.communityeventsproject.com` gets
`communityeventsproject.com` prefilled, which is the starter case and a domain
whose mail already works. It suggests nothing for a community on its own apex:
prefilling `daytonfood.org` would be asserting that it accepts mail, which the
app cannot know, and a confidently wrong guess here is the expensive kind
because the failure is silent. The suggestion also never overwrites a value the
operator has touched, including one they deliberately cleared.

**What deliberately did not move: every credential.** `app_config` has no
encryption at rest -- building that is `v2-7`, and CLAUDE.md already forbids
writing the reserved `tenants` OAuth secret columns before it lands. Fifteen
variables are marked `secret-pending-v2-7` and a test asserts the list, so
moving one into runtime config has to be a deliberate edit rather than a
plausible-looking commit. The mail *identity* (`BREVO_FROM_*` and friends) is
held back with them on purpose: it lives in the same global
`email_provider_config` row as the API key, a provider rejects a From address on
a domain it has not verified, and every cron send path would need auditing for
tenant context first.

### Managing a community from outside it, 2026-08-17

Rob, testing the tenant screens: the first admin is only created with a new
community, the mail domain is only editable from inside one, and there is no way
to delete a community at all. All three are the same gap seen from different
sides -- a system admin holds no account in the communities they administer, and
those communities' admin screens live on their own hosts behind a session for
them. A community whose admin left, forgot their password, or was never created
was permanently unreachable, and the only lever left was suspending the whole
thing.

**Also fixed here: the edit dialog was visually broken.** Its multi-line
`mat-hint`s overflowed a fixed-height subscript area and rendered on top of the
next control -- the Slug field had the domain hint printed through it. The fix
is `subscriptSizing="dynamic"` on every form field, which the settings screens
already used. Worth noting because the dialog was shipped and reviewed twice
without it being spotted in code.

**Mail domain is now editable on edit, not just create.** Deliberately the same
`mail_domain` app_config row its own admin edits -- one setting with two doors
onto it, not two settings that can disagree. Blank clears the row rather than
storing an empty string, because "no row" is what AppConfigService reads as
"inherit the deployment's", and the suggestion never fires in edit mode where it
would silently rewrite a stored value.

**Per-community user management** (`/api/v1/system/tenants/:id/users`): list,
add, change role, suspend/restore, set password. It refuses to touch a service
account or a system admin, and cannot grant `system_admin` -- the same rule
`admin.service.setRole` enforces, because a screen that manages one community
must not be one dropdown away from operating all of them. A user id from another
community is simply not found: the tenant id comes from the route and the
extension filters on it.

**Delete passes three gates**, chosen with Rob over a one-step confirm: never
the root tenant, the community must *already* be suspended, and the caller
retypes its domain. Suspending is instant and reversible and stays the ordinary
way to take a community offline, so making it a prerequisite costs nothing and
separates "take it down" from "destroy it" in time as well as in intent.

Two implementation notes worth keeping:

- **The purge filters by `tenantId` explicitly**, which is the one place in this
  codebase that should ignore the "never write a tenant filter by hand" rule.
  Everywhere else a missing filter returns nothing; here a `deleteMany({})` that
  lost its filter empties every community, and a `$transaction` client is not
  somewhere to bet on a client extension being applied. The filter is written
  where it can be read.
- **Order does not matter, and the RESTRICT keys are the safety net.** Every
  foreign key among the 29 scoped tables is `ON DELETE CASCADE`, so parents and
  children can go in any order; only the `tenant_id` keys are `RESTRICT`, which
  makes the final `tenants.delete()` fail loudly rather than orphan rows if the
  model list ever misses a table. Nothing needed a schema change.

Audit entries for all of this are written against the **root** tenant, not the
community acted on. `audit_log` is scoped, so a delete would take its own record
with it, and the rest would hand a community's admin an edit history of the
operator.

## Deferred: self-service tenants and trial mode

Rob, 2026-08-16, while testing the first second community. Two follow-ons to the
tenant work, both deliberately out of v2-6:

**The first admin should eventually arrive by invitation, not by password.**
Tenant creation currently asks the operator for a password and hands it over,
which is what unblocked testing. The better shape is a one-time setup link the
new operator uses to set their own credentials — no password handling in
between. It depends on the tenant-aware link work (landed) and on email being
configured, and it overlaps heavily with the setup wizard, so it belongs with
**v2-12** rather than as its own item.

**Self-service tenant creation with a trial tier.** Anyone can create a
community and try it, bounded by caps — on the order of 2-5 users and a small
number of locations and events — with the system admin able to move a tenant off
trial onto whatever tier exists if a paid version happens. Needs a tier concept
on `tenants` (the reserved `db_mode` column is a precedent for how that gets
added), enforcement at the point of creating users/locations/events, and a
public signup flow that is not the existing invite-gated one. Sizeable and
product-shaped rather than infrastructure-shaped; number it once the tenant
foundation is finished and the branding/demo block has settled.

### Still outstanding in v2-6

- ~~Cookie scoping~~ **done 2026-08-15.** The session cookie is host-only, so a
  login belongs to the tenant host that issued it. Also fixed on the way: login
  clears the pre-v2-6 domain-scoped cookie (a Set-Cookie on one scope does not
  overwrite another, so it would have outlived the change by a week still shared
  across tenants), self-delete cleared options that never matched what login
  set, and the OAuth redirect host is checked against the tenant registry rather
  than "under BASE_DOMAIN". Google OAuth is now single-host until v2-8's
  REQ-TENANT-01.8 handoff; email/password is unaffected.
- ~~Bootstrap/runtime config split (REQ-TENANT-01.4)~~ **done 2026-08-16.** See
  below.
- ~~Stage verification~~ **closed 2026-08-19.** Ran across several stage
  deploys rather than as one pass at the end, and it is what found most of this
  item's real defects: a newly created community with no way in, an adminless
  community that could not be recovered, no way to delete one, a dialog whose
  hints rendered on top of the fields beneath them, and two pieces of reasoning
  of mine that did not survive Rob checking them (see the service-account
  entries above).

  **Not separately re-verified: v2-5's raw SQL surface** -- the 14 hand-edited
  statements that were deferred to this item's stage pass. Rob closed the item
  with that outstanding, having been told twice. It is the one part of the
  codebase the scoping extension does not cover, so a missing predicate produces
  no compile error and no test failure: the member directory, points leaderboard,
  achievements and the three ratings queries are where to look first if a
  cross-community leak ever surfaces.

---

All six items together close out `docs/REQ-TENANT-01.md`. All new v2 code
is covered by Vitest (unit/integration via Supertest) per that doc's
testing requirements — Playwright e2e is exercised implicitly once tenants
exist, not tested standalone.

---

## Next after v2-6: secrets and per-tenant OAuth

Added 2026-08-14 with Rob, when per-tenant OAuth configuration was specified
(REQ-TENANT-01.9). Kept separate from the branding/demo block below because
these are not cosmetic — the first is a security prerequisite with nothing else
depending on it yet, and the second cannot start until it exists.

**Moved ahead of that block 2026-08-15 with Rob**, and both blocks renumbered
so the number reads as the running order again: the old v2-12/v2-13 became
v2-7/v2-8, and the old v2-7–v2-11 each shifted down two to v2-9–v2-13. That was
only safe because no `v2-<N>` tag above `v2-5` has been cut and nothing outside
this file and CLAUDE.md referenced the old numbers — had either been true the
numbers would have had to stay put and the order be stated in prose instead.
The dependencies are what actually constrain the sequence: **v2-7 before
v2-8**, v2-8 also needs v2-6's user scoping to resolve against, and v2-8 wants
REQ-TENANT-01.8's callback handoff done in the same item.

### v2-7 — Encrypted secrets at rest
**Status:** In Progress. Blocks v2-8.

`schema.prisma` has said since v2-3 that `tenants.google_client_secret` and
`tenants.facebook_app_secret` must be encrypted before anything writes them,
and that whoever first populates them owns building the layer. Nothing has
populated them, so nothing has been built. REQ-TENANT-01.9 is what populates
them, so this comes first.

Worth deciding once, here, rather than per-column later: where the key comes
from (bootstrap env is the only thing available today), what happens on key
rotation, and whether the same mechanism covers the other secrets currently
sitting in plaintext columns — `email_provider_config.brevo_api_key` and
`resend_api_key` are already in that category and would benefit from the same
treatment.

**Definition of done:** a documented encrypt/decrypt path used by at least one
real column, secrets unreadable in a database dump, and a stated answer for key
rotation that does not require re-entering every secret by hand.

### v2-8 — Per-tenant OAuth apps (REQ-TENANT-01.9, REQ-TENANT-01.8)
**Status:** Not started. Depends on v2-7 and on v2-6.

Each tenant supplies its own Google and/or Meta credentials; a provider is
offered only where that tenant has them, and email/password is always
available. See REQ-TENANT-01.9 for the rule and its four consequences.

The two requirements are one item because they are one subsystem: 01.8's
callback handoff has to choose which tenant's client secret to exchange the
code with, and the signed `state` is the only thing that knows. Splitting them
would mean building the callback twice.

Known work beyond the columns themselves:

- `GoogleStrategy` stops being a singleton — credentials are selected per
  request from the resolved tenant, so the strategy's registration changes, not
  just its config.
- Facebook needs far less: it is not a Passport strategy, and the server-side
  half is a Graph API call. The per-tenant part is largely which app id the
  frontend uses.
- A new **unauthenticated, tenant-resolved** endpoint telling the login page
  which methods this tenant offers. `GET /auth/providers` cannot do it — it is
  `JwtAuthGuard`ed and reports the signed-in user's linked accounts.
- The tenant-scoping extension needs the explicit "run as tenant X" override
  REQ-TENANT-01.8 already calls for, since the callback lands on the root host
  but resolves a user belonging to the originating tenant.

**Definition of done:** a tenant with no credentials offers email/password
only; a tenant with Google credentials offers Google and email/password; the
same address can hold a different set of linked providers on two tenants; and
no secret is readable in a database dump.

---

## Deferred: CommunityEvents domain, branding and demo

Agreed with Rob 2026-08-09, after the project got its own domain
(`communityeventsproject.com`). Deliberately **future work** — none of it
starts until everything above is landed and stable, which as of 2026-08-15
means the secrets and per-tenant OAuth items too. Recorded here so the
decisions are not lost between sessions.

Three things that are easy to conflate, kept separate on purpose:

| | What it is |
| --- | --- |
| `www.communityeventsproject.com` | The **root tenant** (`is_root = true`, matches `ROOT_TENANT_URL`). Public landing page explaining the project, and the system-admin tenant — an admin here is the system admin. |
| `demo.communityeventsproject.com` | A **sandbox tenant**. Seeded with generated members, locations, events and a populated leaderboard, with its own colours and logo. |
| `stage.communityeventsproject.com` | **Not a tenant of prod** — a separate deployment (own container, own database). Within that deployment it *is* the root/admin tenant: `ROOT_TENANT_URL` points at it, its tenant row carries `is_root = true`, and an admin there is the system admin of stage. The one Rob develops against until 2.0 goes to prod. **Live as of 2026-08-09**, replacing `communityevents.rtippenhauer.com`. |

### v2-9 — CommunityEvents branding replaces the DinnerBears defaults
**Status:** Not started (deferred)

The per-instance branding already lives in `app_config` and needs no code, but
the *fallbacks* are still DinnerBears: `SITE_SETTING_DEFAULTS` in
`app-config.service.ts`, ~93 hardcoded references across `api/src` (most of
them `dinnerbears.com` in email URLs and fallbacks) and 12 frontend files.

**Definition of done:** a fresh instance with no `app_config` rows presents as
CommunityEvents, and no code path emits a dinnerbears.com URL.

### v2-10 — Root tenant landing page
**Status:** Not started (deferred). Depends on v2-3 and v2-4.

Public marketing page served by the root tenant, explaining the project and
linking to the demo. `frontend/public/landing.html` is the v1-era placeholder
and is the obvious starting point.

**Definition of done:** `www.communityeventsproject.com` and the apex both
serve the landing page and resolve to the same root tenant row.

### v2-11 — Demo tenant
**Status:** Not started (deferred). Depends on v2-3, v2-4 and v2-10.

A tenant anyone can try. Two properties that need care:

- **Self-registration grants tenant admin.** Anyone signing up on the demo
  becomes an admin *of the demo tenant only*. This is a deliberate carve-out of
  the normal invite-gated flow, and it is a privilege-escalation bug the moment
  it applies to any other tenant — so it has to be a property of the tenant
  row, checked against the resolved tenant, and impossible to enable on the
  root tenant.
- **Scheduled reset — nightly, weekly at the very least.** Demo admins can
  delete things, so the tenant is wiped and re-seeded on a timer rather than
  left to accumulate whatever visitors do to it. Nightly is the target;
  weekly is the floor. The demo seed is a third seed path, distinct from
  `prisma/seed.ts` (reference data every install needs) and `bootstrap.js`
  (one-time instance provisioning).
- **Say so on the page.** A persistent notice on the demo tenant that
  everything there is temporary and wiped on a schedule. Someone who
  self-registers becomes an admin and may well start entering real events for
  a real group; without a visible warning the reset destroys work they had no
  reason to think was disposable. The notice is part of the feature, not
  decoration.

**Definition of done:** a visitor can self-register on the demo, land as an
admin of that tenant with generated members/locations/events/leaderboard
present, sees a standing notice that the data is temporary, and the tenant
returns to its seeded state on schedule. The same self-registration on any
other tenant still yields an ordinary member.

### v2-12 — Operator setup wizard / everything configurable from the site
**Status:** Not started (deferred). Depends on v2-6.

REQ-TENANT-01.4 splits config into bootstrap (env, set once) and runtime
(DB-backed, editable in the UI) but stops short of building the UI. This is
that UI: an operator finishing a fresh install should be able to configure the
instance from the website rather than by hand-editing env vars, including
being walked through the third-party setup each integration needs — Google
OAuth, Facebook Login, DNS, and email (Brevo/Resend).

The prompting matters as much as the fields. An operator who has never
registered a Meta app does not know what a redirect URI is, and the failure
mode is a half-configured instance where login silently does not work.

**Definition of done:** a new instance can be taken from first boot to working
Google login, Facebook login, email delivery and correct DNS without editing
env vars by hand, with the wizard telling the operator what to do in each
third-party console.

### v2-13 — Operator handbook
**Status:** Not started (deferred).

The written counterpart to v2-12: what an operator needs before and during
setup. Same content, different form — the wizard prompts in the moment, the
handbook is what they read beforehand and what support points at afterwards.

Existing material to fold in rather than rewrite: `docs/FACEBOOK_APP_SETUP.md`,
`docs/FACEBOOK_REVIEW.md` and `docs/NEW_INSTANCE_SETUP.md` already cover most
of the Meta path from v1, including the business-verification requirement for
going Live.

**Definition of done:** a single document covering domain/DNS, Google OAuth,
Meta app creation plus review and business verification, and email provider
setup, accurate enough that someone other than Rob can stand up an instance
from it.
