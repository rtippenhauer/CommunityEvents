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
**v2-14** rather than as its own item.

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
**Status:** Complete (2026-08-23). Tag `v2-7`.

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

#### What landed

**A second Prisma Client Extension**
(`api/src/database/prisma/secret-encryption.extension.ts`), applied beside tenant
scoping, for the reason that one exists at all: a service that forgets to encrypt
does not fail. The credential works, the screen looks right, and the plaintext is
found later by whoever finds the backup. Services read and write plaintext;
adding a column means adding it to `encrypted-columns.ts`, which is where the
three registered tables are declared -- `email_provider_config`
(`brevoApiKey`, `resendApiKey`), `tenant_secrets` (`secretValue`) and the two
`tenants` OAuth columns v2-8 will be first to write.

AES-256-GCM, random IV per value, **the column name authenticated as AAD** so a
ciphertext moved between columns fails rather than working in the wrong place.
Every envelope names the key that wrote it, which is what makes rotation a
background task instead of an outage.

**The key is bootstrap config and never in the database** -- a dump holding both
is a dump of the plaintext. `secret-key-bootstrap.ts` runs from `main.ts` after
the database is reachable and generates one **only when the database holds no
encrypted value**: what the data contributes is not the key but a constraint on
it. Three outcomes, all decided at startup rather than at the first credential
read: refuse to generate with secrets present, refuse a key that cannot read what
is stored (naming the key ids it needs), and warn when data is still under a
retired key. Legacy plaintext names no key, so a pre-v2-7 database still
generates cleanly, and reads tolerate plaintext with a once-per-column warning
until the rewrap ends it.

**Rotation loses nothing; losing the key loses everything.**
`SECRET_ENCRYPTION_KEYS_RETIRED` + `npm run secrets:rewrap` moves every value
onto a new key with the deployment serving throughout. `npm run secrets:reset` is
the explicit destructive recovery, guarded by a confirmation phrase rather than a
boolean. `rewrap-secrets.ts` deliberately uses a bare client -- rewrapping
through the extension would be a no-op that reported success.

**Three per-community secrets** (`tenant_secrets`, Admin → API Keys):
`geocoding_api_key`, `places_api_key`, `anthropic_api_key`, resolved
most-specific-first with the env var as the deployment default. Each is metered
against whoever owns the key, which is the argument for per-community. The
`secret-pending-v2-7` env class became plain `secret`, with a reason recorded per
variable for the ones that stayed.

**A stored credential never goes back out over HTTP.** `GET /admin/email/config`
had been answering with the operator's Brevo key in plaintext on every page load,
which would have undone the column encryption at the last hop; it now answers
`brevoApiKeySet: boolean`, with an explicit Remove replacing clear-by-blanking.

**Two constraints the extension imposes**, both documented in CLAUDE.md: an
encrypted column cannot be filtered, ordered, grouped or joined on (the extension
throws rather than letting a randomised cipher silently match nothing, which
reads as "no such key"); and raw SQL still bypasses extensions, so a `$queryRaw`
touching one must call the cipher itself. None does today.

Docs: `docs/SECRETS.md` (operator-facing) and `docs/TENANT_ONBOARDING.md`
(provider-side setup, written ahead of v2-9's code).

#### Stage pass

Key generation onto a real volume, persistence across container recreate, the
Admin → Email write path with a real Brevo key, Cloudflare Email Routing on
`communityeventsproject.com`, and Brevo authenticated on
`stage.communityeventsproject.com` in a new Community Events account.

**The defect stage found is the one no test could.** `/app/appdata` was mapped in
neither `docker/docker-compose.yml` nor the Unraid template, so the generated key
lived only inside the container: three recreates produced three keys while the
log said, loudly and correctly, to back up a file that could not survive. Nothing
was lost only because nothing was encrypted under them yet -- once something is,
that deployment refuses to start. Fixed on stage by hand and then in both files
(`2179d42`).

Four documentation fixes came out of the same pass: an SMTP key is not an API
key, an API key is not tied to a domain, and DNS verification commands that work
on Windows.

Deferred out of this item's stage pass, not lost: the junk-key refusal path, a
real geocoding key end-to-end, v2-5's raw SQL surface (which needs two populated
communities -- stage now has them), and confirming no stale Brevo template IDs
carried over from the DinnerBears account.

#### Landed on this branch, belonging elsewhere

- `748df4a` -- invite links were discarded when opened by an already-signed-in
  browser (`/login` read the session before the query string). Not tied to any
  item; found while stage-testing invites.
- Five commits of **v2-10** email and legal branding, done early at Rob's
  direction: `{{brand}}` substituted at enqueue time, the settings form's
  DinnerBears fallback, the invite email's hardcoded description, platform legal
  templates seeded per community with a review gate, and the restore button. See
  v2-10 below -- its remaining scope is unchanged apart from these.

### v2-8 — Per-tenant OAuth apps (REQ-TENANT-01.9, REQ-TENANT-01.8)
**Status:** In Progress (started 2026-08-29). Depends on v2-7 and on v2-6,
both done. Runs after v2-9, which was taken first.

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

#### Known gap, deliberately deferred: login CSRF

**The signed `state` proves which community, not which browser.** It stops a
forged tenant id -- which would be a cross-tenant account takeover, and is what
the signing exists for -- but an attacker can obtain a perfectly valid `state`
simply by starting a flow of their own. Feed a victim the resulting callback
URL and the victim's browser completes *the attacker's* sign-in and lands
logged into the attacker's account. The harm is the victim then acting inside
somebody else's account without noticing, which is materially less than
takeover, and it is not a regression: v1's state was unsigned and had the same
property. But it is the other half of what a `state` parameter is normally
expected to cover, and it should not be rediscovered as a surprise.

The conventional fix -- bind `state` to a nonce in a cookie -- normally cannot
work in this architecture, because the authorization request is on the tenant's
host and the callback is on the root host, so a cookie set at the start is not
readable when the callback runs. **The handoff makes it work anyway**, which is
the part worth writing down: redemption happens back on the originating host,
where that cookie *is* readable. Set a nonce cookie at `/auth/google`, carry its
hash through `state` into the `oauth_handoffs` row, and require it to match at
redemption.

Deferred to its own branch after v2-8's stage pass, decided with Rob
2026-08-30, to keep this item's diff reviewable and get the cross-host OAuth fix
onto stage sooner. **PKCE was considered and rejected** for the same flow: this
is a confidential client with a server-side secret, so the payoff is small, and
the same cross-host split means the `code_verifier` would need its own storage
row -- real cost, marginal benefit.

#### Deferred to v2-12: a callback on the community's own host

Every callback currently terminates on the deployment's single registered URI,
and `oauth_handoffs` carries the session the last hop. A community that owns its
domain does not need that detour, and REQ-TENANT-01.8 always said so -- it left
the direct path "undesigned until someone asks for it". Asked for, 2026-08-30;
agreed with Rob to build it separately rather than widen v2-8. **The design,
including the four-case table and the policy decision that makes it simple, is
recorded here rather than in v2-12** -- it was worked out against this item's
code and reads better next to it.

**Why the fixed URI is not simply obsolete**, which is the part worth not
re-deriving. Adding an authorised domain to a Google project means verifying
ownership in Search Console, so a redirect URI can only live on a domain the
project's owner controls. Four cases:

| Tenant host | Whose Google project | Fixed URI | Own-host URI |
| --- | --- | --- | --- |
| subdomain of ours | ours | works, zero setup | a console edit per community |
| subdomain of ours | theirs | impossible | impossible |
| their own domain | theirs | impossible | works |
| their own domain | ours | works | impossible |

Row 1 is the self-service and demo case and is the fixed URI's real
constituency: one URI already registered covers every client in that project, so
a new community needs no console interaction at all. Row 3 is what the direct
path unlocks.

**Row 4 is disallowed by policy, decided with Rob 2026-08-30**, and that
decision is what makes the design simple: a community that brings its own domain
but will not run its own Google project gets email/password, exactly as
REQ-TENANT-01.9 already says for a community that registers no app. With row 4
gone, nothing in rows 1-3 conflicts, so the two paths can coexist without a
per-tenant setting having to be right.

Shape: a nullable/boolean flag on `tenants` (the callback path is ours, so only
the *host* varies -- deriving it from the tenant's domain avoids validating a
free-text URL that could point anywhere); `GoogleOAuthService.callbackUrl`
becomes per-tenant and must return the same value on both legs, since Google
matches `redirect_uri` at the token exchange too; the direct path skips the
handoff entirely and sets the cookie itself, and should still check the signed
state's tenant against `req.tenant` rather than trusting the host alone. The
admin screen shows whichever URI applies.

**Worth carrying into that phase: email and OAuth have opposite fallback
policies.** `v2-9` lets a community with no Brevo key send on the deployment's
credentials; REQ-TENANT-01.9 gives OAuth no platform fallback at all. There is a
real argument for the asymmetry -- mailing *as* a community creates no
relationship between its members and Brevo, whereas signing them in through the
platform's app makes the platform the party they granted consent to -- but a
self-service deployment means several communities sharing one Brevo allowance,
which is the quota trap `v2-9` documents. Decide it deliberately rather than by
inheritance.

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

### v2-9 — Per-community email sending

**Status:** Complete (2026-08-29). Tag `v2-9`.

**Runs before v2-8, decided 2026-08-23 with Rob.** The numbers stay put this
time -- `v2-7` is tagged, so renumbering is no longer free, and the order is
stated rather than encoded. Neither item depends on the other, and stage decided
it: two communities now run there on two Brevo accounts, which is exactly what
this item's stage pass needs and v2-8's does not benefit from (the second
community is email/password-only until v2-8 itself lands).

**The trigger was an isolation gap, not the missing feature.** `/admin/email` is
`@Roles(ADMIN)` with no root-tenant check, acting on a global row, so any
community's admin can rewrite the whole deployment's sending credentials and the
From identity every other community sends under. Found on stage by entering a
second Brevo account's key on the second community's host and watching the first
community's counter move.

Today `email_provider_config` is one global row -- a single Brevo key, a single
sending identity, one daily quota -- so every community's mail leaves under the
deployment's name. This makes it per-community: `tenant_id` on the model, its
seeding moved from `seed.ts` into `bootstrap.ts` (seed runs before any tenant
exists, exactly as v2-6 found with `app_config`), the four
`findUnique({ where: { id: 1 } })` reads becoming scoped `findFirst`s, and the
`@Cron` dispatcher re-entering `runWithTenant` per message rather than composing
under one `runUnscoped` -- the documented v2-6 trap, and the one that silently
sends with another community's identity.

`BREVO_WEBHOOK_SECRET` moves with the key rather than separately: it
authenticates callbacks from a Brevo *account*, so a community with its own
account has its own webhook config and its own secret, arriving on its own host.
Only the authentication moves. **The handler stays `runUnscoped`** -- a hard
bounce is a property of the address and not of whichever community mailed it,
and scoping it would leave every other community still mailing a dead address,
which is what gets a sending domain blocked.

Split out of v2-7 on 2026-08-21 with Rob, having first been folded into it. It
is v2-6-sized rather than a tail: the encryption v2-7 built is what makes
per-tenant keys storable, but storing them is the small part. This renumbered
the old v2-9–v2-13 down one, which was still free -- no `v2-*` tag above v2-6
has been cut.

**Not just code.** A provider rejects a From address on a domain it has not
verified, so a community supplying its own key also has to authenticate its own
sending domain and route inbound mail. Those manual steps are documented ahead
of the code in `docs/TENANT_ONBOARDING.md`, which v2-7 wrote.

**Definition of done:** two communities on one deployment sending under their
own verified domains, each against its own quota, with bounces from either
correctly suppressing the address everywhere. **Met on stage 2026-08-29**, the
last piece being a `delivered` callback authenticating against a freshly rotated
token on an adopted webhook.

**What actually landed**, beyond the scoping above:

- **Self-registering webhooks per community.** `BrevoWebhookService.register()`
  calls Brevo's API rather than asking an operator to paste a URL. The token is
  ours, which is the whole reason rotation can be automatic: 30 days, with the
  replaced token honoured for a 7-day grace. The API key cannot be rotated the
  same way -- Brevo mints it and exposes no reissue endpoint -- so it gets a
  60-day quiet-community warning instead, since Brevo deactivates a key after 90
  days without a send.
- **The daily counter was wrong twice, in opposite directions.** `sendNow`
  bypasses the dispatcher by design, so password resets, verification and
  security alerts were never counted at all. And the sending day ended at UTC
  midnight, which is 8pm Eastern -- so the screen read `1 / 300` on two
  communities after four messages. `EMAIL_QUOTA_TIMEZONE` now draws the boundary;
  `last_reset_date` widened from DATE to DATETIME(3) so the rollover is a
  conditional write both send paths can perform safely.
- **The allowance belongs to the account, not the community.** Rob's
  observation, and the item's most durable outcome. Communities without their own
  key share one Brevo account and one allowance, which no per-community counter
  can see. Attribution and budget are now separate numbers, both shown, and the
  budget gates sending. Refreshed where it matters -- before a batch, after a
  send, on a page load, and on Send Now even with an empty queue -- rather than
  on an interval.

  This also settled the timezone question. The setting was built to mirror the
  provider's reset; that turned out to be unknowable (no timezone field on the
  account, and separate accounts may reset on separate cycles), and the account
  budget is what makes it safe not to know. So the setting is the operator's
  calendar day, for legibility, and not an attempt to track Brevo.

**Traps, all runtime-only:** Brevo's registration API spells events camelCase
(`hardBounce`) while its payloads use snake_case (`hard_bounce`), so a webhook
registered with the payload spelling is accepted and never fires. An encrypted
column cannot be filtered on, so the grace sweep keys on `webhookRotatedAt`
alone. `runUnscoped(reason, () => prisma.x.updateMany())` returns a lazy promise
that runs outside the context -- it threw on stage on the first hour boundary,
and nothing caught it because no test ran a cron. And **"mint a new token" is not
"create a new webhook"**: conflating them made the Re-register button POST every
time, which Brevo rejects with `duplicate_parameter` for a URL it already holds,
so the button could only ever succeed on a community that had no webhook -- the
one case nobody presses it in.

**Stage found five things tests did not:** a community with no config row got a
permanent spinner on the one screen that could create it; an idle community never
advanced its row and so displayed a window that had closed two days earlier; the
cron sweeps threw on every hour boundary; `provision-tenant.ts` seeded neither
the email row nor the legal pages; and the Re-register button above, found by
pressing it once before the merge. Separately, a `prisma generate` skipped after
a schema change left local tests running against a client that still believed a
column was a DATE -- the image was never affected, since the Dockerfile generates
during the build.

**Known and deliberate:** template ids are scoped too, so a newly created
community has none and falls back to `BREVO_TEMPLATE_*`. With those unset the
invite goes out on the raw-HTML fallback -- it sends and delivers, which is
exactly why it is easy to miss. Set them on the deployment, or per community.

### v2-10 — CommunityEvents branding replaces the DinnerBears defaults

**Reframed 2026-08-30 with Rob, and this is the organising idea rather than a
longer checklist.** The item has read as "remove DinnerBears", which has no
clear finish line -- every pass removes some and leaves the rest looking like an
oversight, which is exactly how it has felt across three items now. The end
state is instead:

> **CommunityEvents is the platform identity. Every DinnerBears artifact either
> becomes its CommunityEvents equivalent, or becomes data owned by the
> DinnerBears community when it migrates.**

Nothing needs to keep working as a DinnerBears default, because DinnerBears
stops being the default and becomes a tenant like any other -- with its own
`app_config` rows, its own uploaded artwork, its own terminology. That makes
every question below answerable: a fallback is CommunityEvents, a community's
own value is whatever it uploaded, and there is no third case.

#### Why it keeps recurring: three different problems wearing one label

The audit (2026-08-30) found 23 references in `api/src`, 19 in `frontend/src`,
31 bear/paw terminology hits, plus seed data and static assets. They are not one
task:

**1. Renames and fallbacks.** Mechanical. `dinnerbears.com` URL fallbacks, email
copy, `instance-contact.ts`, `calendar.service.ts`. The rule from v2-6 still
governs: resolve the *tenant's* brand and interpolate it; only the
deployment-wide fallback becomes CommunityEvents. `SITE_SETTING_DEFAULTS.brand_name`
is already `CommunityEvents`, so this is finishing a job, not starting one.

**2. Assets, which need artwork rather than code.** This is the part that cannot
be done by editing strings, and the reason previous passes stopped short. The
frontend hardcodes these as the fallback a community with no uploads gets:

| Constant / file | Where it shows |
| --- | --- |
| `DEFAULT_LOGO = assets/logo.png` | nav bar; also both PWA icon sizes |
| `DEFAULT_SPLASH = images/dinnerbears-splash.png` | login page hero |
| `DEFAULT_ICON = images/DinnerBearsIcon.png` | favicon, apple-touch-icon |
| `images/ErrorMenuBoard.png` | the frame around every error page -- **not configurable at all**, so no community can override it |
| `public/backgrounds/background-chef.png`, `background-cool.png` | page backgrounds, via `gen-bg-manifest.js` |
| `src/index.html` | `<title>DinnerBears`, apple-mobile-web-app-title, icon links |
| `public/manifest.webmanifest`, `manifest.stage.webmanifest` | PWA name, short_name, description "Bear memories" |
| `public/landing.html` | v1-era placeholder |

`ErrorMenuBoard.png` is the sharpest instance: a member of any community sees
DinnerBears artwork on every error, and there is no setting that changes it.

**3. Branding seeded *into* new communities, which is the structural miss.**
`prisma/seed-data/achievements.json` writes "Founding **Bear**" and "Attended 5
**DinnerBears** dinners" as real rows in every community at creation. Unlike a
fallback, a community cannot override these -- they are its data, and they are
already wrong in both communities on stage. v2-6 made branding per-community and
the seed data never followed. Either the descriptions interpolate the
community's own terms at read time (as the legal templates already do via
`getPublicValue`), or they become generic. `term_points` = "Bear Points" is the
same shape: configurable, seeded wrong.

#### Definition of done, restated

A fresh install with no `app_config` rows and no uploads presents as
CommunityEvents in every surface -- nav, login, favicon, PWA, error pages,
backgrounds, achievements. A community that has set its own branding sees its
own everywhere, including in email subjects and bodies. No code path emits a
dinnerbears.com URL. DinnerBears' own artwork and copy exist only as that
community's rows and uploads after it migrates.

### v2-11 — A real colour system

**Status:** Not started. Numbered 2026-08-30, immediately after v2-10 because
the two share a surface: the branding pass decides what a community *is*, and
this decides what it *looks like*, and doing them in the other order means
restyling the same components twice. v2-13's landing page and v2-14's demo
tenant both want it finished.

Branding today is **three** admin-editable colours
-- `--db-primary`, `--db-accent`, `--db-cream` -- and `frontend/CLAUDE.md`
already records the two places that falls down: `on-primary` text is hardcoded
white rather than contrast-computed, so a light brand colour renders unreadable;
and hover and derived shades are not generated, so an unusual hue looks wrong in
the nav and in button states. Both are accessibility problems, not taste ones.

A conventional token set is roughly: primary and `on-primary`; accent and
`on-accent`; surface and surface-variant; outline; text primary / secondary /
disabled; and the semantic four -- success, warning, error, info -- each with an
`on-` pair.

**Decided with Rob 2026-08-30: seed-and-derive, with per-token overrides.**
Three tiers, each an escape hatch from the one before, so the common case is one
click and the rare case is still possible:

1. **Pick a preset.** A short curated list of complete palettes. Most communities
   stop here and never see a colour picker.
2. **Set one or two seed colours.** Everything else is derived -- tints and
   shades for hover and active states, surfaces, outline, and every `on-` colour
   computed for contrast rather than assumed white. This is what fixes the
   unreadable-light-brand problem by construction rather than by asking an admin
   to notice it.
3. **Override any individual token.** Full control for whoever wants it.

**Overrides must survive re-derivation**, which decides the storage shape: keep
`{ seeds, overrides }` and derive at read time, rather than materialising a flat
set of colours. Otherwise changing a seed either silently discards an override
or silently keeps a stale one. The codebase already has this pattern twice --
legal templates interpolate on the public read rather than at seed time, and
contact addresses resolve most-specific-first -- so it is the house style, not a
new idea.

**Contrast is checked even on overrides**, and warns rather than blocks. An admin
who insists on a low-contrast pair should be told what it will do to their
members, not silently obeyed or silently overruled.

The semantic four -- success, warning, error, info -- stay platform-fixed.
Red-means-error is not a branding choice.

#### Ship the prompts, not just the pickers

Rob's idea, and the part that makes tier 2 usable by someone who does not think
in hex: put a **copyable prompt** on the screen that an admin can paste into
ChatGPT or Claude, together with a **paste-back format** the screen accepts. The
round trip becomes: describe your community in words -> get a palette -> paste
it in -> preview -> save.

That only works if the prompt names our tokens and constraints exactly, so the
answer is directly importable. Draft to react to:

> You are helping choose a colour palette for a community website. Return **only**
> a JSON object, no commentary, in exactly this shape:
>
> `{"primary":"#RRGGBB","accent":"#RRGGBB","surface":"#RRGGBB"}`
>
> Constraints:
> - `primary` is used for buttons, links and highlights; `accent` for secondary
>   actions; `surface` is the page background and should be very light or very
>   dark, not mid-tone.
> - White or black text must reach WCAG AA contrast (4.5:1) against `primary`
>   and against `accent`.
> - `surface` must reach 4.5:1 against a near-black and a near-white body text
>   colour, so state which of the two the design assumes.
> - Avoid pure `#000000` and `#FFFFFF`.
>
> The community is: **<describe it -- its name, what it does, the feeling you
> want>**.

Validate on paste rather than trusting it: parse, check the ratios ourselves,
and show the preview before anything is saved. An LLM will occasionally return a
pair that fails its own brief, and the screen should catch that rather than the
members.

Work: a token layer feeding both the `--db-*` and Material `--mat-sys-*`
variables; the derivation function with contrast checks; migrating component
styles off the three current variables; the preset list; and an admin screen
with live preview, the prompt, and the paste-back importer.

Note `index.html`'s `theme-color` and the webmanifest are static, pre-bootstrap
files with no CSS-variable indirection, so they do not follow a runtime change
-- the same limitation the branding item hits, and worth deciding once for both.


**Status:** Not started (deferred) -- **except five commits landed early on the
v2-7 branch** at Rob's direction, because stage testing kept surfacing them:

- `b219c5e` -- emails carry the community's name. `{{brand}}` is substituted once
  in `EmailService` at **enqueue** time, not at dispatch: the cron drains every
  tenant's queue under one `runUnscoped`, so branding read there is whichever
  community the engine reached first.
- `dad8b50` -- the settings form defaulted to `DinnerBears`, so the screen for
  fixing branding was the screen that wrote it back as a stored row.
- `7da6ace` -- the invite email asserted its recipients "love good food and great
  company"; it now carries the community's own tagline. Took three more copies of
  the DinnerBears tagline with it, including the seeded row that made
  `SITE_SETTING_DEFAULTS` irrelevant.
- `0dd9e5d` / `8ca6f27` -- platform legal templates seeded per community, filled
  in on the public read, with a review gate and a restore button. See the
  Multi-Tenancy section of CLAUDE.md.

Everything below is unchanged apart from those. Still DinnerBears' in
`prisma/seed-data/app_config.json`, and needing content decisions rather than
renames: `about_story_html` (the real origin story, named people, dated
milestones), `home_hero_html`, `home_howitworks_html`, `term_points` = "Bear
Points", and a leftover `tz_probe` row. Two more found on stage: the footer
hardcodes `.Com, LLC` after the brand name (`app.component.html:444`), fabricating
a legal entity for every community -- `LEGAL_ENTITY_NAME` now exists for exactly
that -- and the invite subject appends `!` to a name that may already end in one.
`frontend/public/manifest.webmanifest` still names the PWA DinnerBears, and being
per-deployment rather than per-community it needs a decision about what a single
deployment serving many communities calls itself.

The per-instance branding already lives in `app_config` and needs no code, but
the *fallbacks* are still DinnerBears: `SITE_SETTING_DEFAULTS` in
`app-config.service.ts`, ~93 hardcoded references across `api/src` (most of
them `dinnerbears.com` in email URLs and fallbacks) and 12 frontend files.

**Not a find-and-replace, and this is the trap.** Branding became per-community
in v2-6: `app_config` is tenant-scoped, so `brand_name` is whatever each
community chose. Swapping the literals to "CommunityEvents" would be the same
mistake one level up -- a community called "Dayton Dinners" would send mail
saying "Welcome to CommunityEvents!". Every one of these sites has to resolve
the *tenant's* brand name and interpolate it; only the deployment-wide
fallbacks become CommunityEvents.

Two consequences follow. Email bodies composed in a `@Cron` sweep must re-enter
`runWithTenant` to read branding, or they render whichever tenant the engine
reached first -- the v2-6 trap already documented in CLAUDE.md. And a string
like `subject: 'Verify your DinnerBears email'` becomes an async lookup, which
changes the shape of the functions holding it.

**Found on the v2-7 stage pass**, which is how the numbers below got specific:
a real invite and a real verification email both arrived branded DinnerBears
from a sender correctly named "Community Events Project". The From identity
comes from `brevoFromName` and was already configurable; the body copy is
string literals (`auth.service.ts:1110-1116` among them). Current count is 38
non-comment references in `api/src` across 14 files and 14 in the frontend
across 5 -- lower than the ~93 above, which counted comments and `.spec` files.

**Email bodies are part of this, and provider templates are not.** Decided with
Rob 2026-08-29, at the end of v2-9. Every email's HTML is an inline string at its
call site -- about 15 of them -- and only four of the thirteen names in
`EmailTemplate` are wired to a `templateId` at all. Brevo with no template id
falls back to that same `htmlBody`, and `ResendService` has no template concept
whatsoever and only ever sends it. So the inline HTML is not a degraded path, it
is **the uniform one**: one string, built once, delivered identically by either
provider.

That is the argument against adopting Brevo's template store, which was
considered and rejected here. It would improve Brevo only and silently diverge
from what Resend sends on overflow -- two versions of every email, one of which
nobody looks at until the day it is the one that goes out. Brevo templates are
also per-*account*, so communities sharing the deployment key would share them,
against the per-community branding v2-9 established. The reason to use a provider
template store is its drag-and-drop designer; nobody here intends to open it.

So the branding work covers the bodies themselves. They are plain -- a heading, a
paragraph, an inline-styled button -- and improving them lands on both providers
at once, with no per-account state, no template ids to track and no provider API
call at setup.

**One log line to fix with it:** `BrevoService.getTemplateId` logs
`No Brevo template ID for <name>` at **WARN** on every send without one. Since
template ids are per-community as of v2-9, a newly created community has none and
this fires for every message it ever sends -- describing a supported and now
preferred configuration as though it were a fault. Drop it to `DEBUG`.

**Definition of done:** a fresh instance with no `app_config` rows presents as
CommunityEvents; a community that has set its own `brand_name` sees that name
everywhere including in email subjects and bodies; no code path emits a
dinnerbears.com URL; and a community that has configured no provider templates
produces no warnings for it.

### v2-12 — OAuth callback on the community's own host

**Status:** Not started. Depends on v2-8. Design, rationale and the four-case
table live under v2-8's "Deferred to v2-12" note -- they were worked out against
that item's code and are not repeated here.

In short: a community that owns its domain *and* runs its own Google project
registers `https://<its domain>/api/v1/auth/google/callback` itself, so the
callback arrives on the right host, the tenant resolves from the Host header,
and the cookie is set directly -- no `oauth_handoffs` hop. Communities on a
subdomain of this deployment keep the single registered URI and the handoff,
because their operator cannot register a redirect URI on a domain they do not
own, and one URI covers every client in the project, so self-service onboarding
needs no console edit.

A boolean on `tenants` rather than a free-text URL: the callback path is ours,
so only the host varies, and deriving it from the tenant's domain removes a
field that could otherwise point anywhere.

**Definition of done:** a community flagged for its own host completes a Google
sign-in with no handoff row written; a community not flagged is unchanged; both
are exercised on stage; and the admin screen shows whichever redirect URI that
community's operator actually has to register.

### v2-13 — Root tenant landing page
**Status:** Not started (deferred). Depends on v2-3 and v2-4.

Public marketing page served by the root tenant, explaining the project and
linking to the demo. `frontend/public/landing.html` is the v1-era placeholder
and is the obvious starting point.

**Definition of done:** `www.communityeventsproject.com` and the apex both
serve the landing page and resolve to the same root tenant row.

### v2-14 — Demo tenant
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

### v2-15 — Operator setup wizard / everything configurable from the site
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

### v2-16 — Operator handbook
**Status:** Not started (deferred).

The written counterpart to v2-15: what an operator needs before and during
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
