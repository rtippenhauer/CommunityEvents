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

**Current v2 work item:** `v2-10` — CommunityEvents branding replaces the
DinnerBears defaults. Reframed 2026-08-30: not "remove DinnerBears" (which has
no finish line and has felt like an oversight across three items) but
"CommunityEvents is the platform identity, and every DinnerBears artifact either
becomes its CommunityEvents equivalent or becomes data owned by the DinnerBears
community when it migrates". `v2-11` (a real colour system) shares that surface
and follows it. See `V2_PHASES.md`.

**Completed v2 items:**
- **`v2-8` — Per-tenant OAuth apps** (2026-09-01, REQ-TENANT-01.9 and
  REQ-TENANT-01.8). Each tenant supplies its own Google and/or Meta credentials
  in the four columns reserved since `v2-3` and encrypted since `v2-7`; this is
  what first writes them. A provider is offered only where that tenant has
  credentials, and email/password always is — `GET /auth/methods` is
  unauthenticated and tenant-resolved, and `TenantOAuthService.offeredProviders`
  selects **only the two id columns** so a page load never decrypts a secret.
  `GoogleStrategy` stopped being a singleton: it is constructed per request from
  the resolved tenant, which is why the file and its callback guard are gone.

  **The cross-host handoff is the substance, not the columns.** Google returns
  to one fixed host and the host-only cookie `v2-6` introduced does not reach
  any other tenant's host, so OAuth worked on the callback tenant and nowhere
  else. `state` is now signed (HMAC-SHA256 over an HKDF-separated key, 15-minute
  age limit, `timingSafeEqual` with a length pre-check) and names the
  originating tenant; the callback mints a single-use `oauth_handoffs` ticket and
  redirects to that tenant's own host, which redeems it and sets the cookie
  there. `SameSite=strict` was expected to need loosening to `lax` and does
  **not** — confirmed in a real browser, because SameSite governs whether a
  cookie is *attached* to a request, not whether one can be *set* in a response.
  Don't revert it.

  Four defects found by stage testing, three of them behavioural. A cancelled
  sign-in checked `query.error` **before** decoding `state`, discarding the
  tenant Google had just returned, so Cancel landed on the wrong community.
  Google silently re-linked on email match after Disconnect while Facebook
  refused — opposite policies for the same gesture; Google now matches Facebook.
  `POST /auth/facebook` never verified *which app* minted the token, latent with
  one app and a cross-community hole with per-tenant ones — it now calls
  `debug_token` and compares `app_id`. And `exchange_failed` logged nothing at
  all, dropping `InternalOAuthError.oauthError` where the provider's actual
  reason lives.

  **Deferred deliberately, both recorded in `V2_PHASES.md` rather than lost:**
  login CSRF (the signed `state` proves which *community*, not which *browser* —
  the conventional nonce-cookie fix is unusually available here because
  redemption happens back on the originating host), and `v2-12`'s callback on a
  community's own host. The four-case table behind that second one lives in
  v2-8's section because it was worked out against this code; the policy that
  makes it simple is that a community bringing its own domain but not its own
  Google project gets email/password, exactly as REQ-TENANT-01.9 already says.
- **`v2-9` — Per-community email sending** (2026-08-29). `email_provider_config`
  is tenant-scoped: each community holds its own Brevo key, From identity,
  template ids and daily counter, and a community that sets none sends on the
  deployment's env credentials exactly as before. Seeding moved out of `seed.ts`
  into `bootstrap.ts` and `tenants-admin.service.create`, the four
  `findUnique({ id: 1 })` reads became scoped `findFirst`s, and the dispatcher
  groups its batch by `tenantId` and re-enters `runWithTenant` per community.

  **The trigger was isolation, not the feature.** `/admin/email` is
  `@Roles(ADMIN)` with no root check and acted on one global row, so any
  community's admin could rewrite the whole deployment's sending credentials.

  Webhooks are per-community and self-registering (`BrevoWebhookService`): the
  token is **ours**, minted here and handed to Brevo through their API, which is
  the only reason rotation can be automatic — 30 days, with the replaced token
  honoured for a 7-day grace so callbacks in flight are not rejected. The API key
  beside it is the opposite: Brevo mints it and offers no reissue endpoint, so it
  gets a warning rather than a schedule. **The handler stays `runUnscoped`** — a
  bounce is a property of the address, not of whichever community mailed it.

  Five traps worth not re-discovering. Brevo's *registration* API names events in
  camelCase (`hardBounce`) while the *payload* it posts uses snake_case
  (`hard_bounce`), so a webhook registered with the payload spelling is accepted
  and simply never fires. An encrypted column cannot be filtered on, which is why
  the grace sweep keys on `webhookRotatedAt` alone and clears unconditionally.
  `runUnscoped(reason, () => prisma.x.updateMany())` returns a lazy Prisma
  promise that executes *outside* the context — it threw on stage on the first
  hour boundary, and no test caught it because nothing ran a cron.
  `GET /v3/account` carries no timezone field, so the provider's day cannot be
  asked for. And **"mint a new token" is not "create a new webhook"** — conflating
  them made the Re-register button POST every time, which Brevo rejects with
  `duplicate_parameter` for a URL it already holds, so the button could only ever
  work on a community that had none. `upsertWebhook` now updates, falls back to
  creating on a 404, and adopts an existing webhook by URL on a duplicate.

  **The counters were wrong twice, in opposite directions.** `sendNow` bypasses
  the dispatcher by design, so password resets, verification and security alerts
  were never counted; and the day ended at UTC midnight — 8pm Eastern — which is
  not the operator's calendar day. `EMAIL_QUOTA_TIMEZONE` now draws the boundary
  (`quota-day.ts`), `last_reset_date` widened from DATE to DATETIME(3) so it is
  an instant SQL can compare, and both send paths do the rollover as a
  conditional write rather than a read-modify-write.

  **A provider's allowance belongs to the account, not the community**, which is
  the rule that outlives this item — see the Multi-Tenancy section.

  Stage found what tests could not, again: an idle community never advanced its
  row, so the screen reported a window that had closed two days earlier, fixed by
  deriving it at read time rather than writing on a GET; and the Re-register
  button above, found by pressing it once before the merge. Also worth knowing —
  a `prisma generate` skipped after a schema change left local tests running
  against a client that still believed a column was a DATE. The image was never
  affected, since the Dockerfile generates during the build.
- **`v2-7` — Encrypted secrets at rest** (2026-08-23). Every credential in the
  database is encrypted by a second Prisma Client Extension applied beside tenant
  scoping — AES-256-GCM, random IV per value, the column name authenticated as
  AAD so a ciphertext moved between columns fails instead of working in the wrong
  place. Services read and write plaintext; adding a column means adding it to
  `encrypted-columns.ts`. The rules it established are in the NestJS conventions
  and Multi-Tenancy sections above.

  The key is bootstrap config and never in the database. A fresh deployment
  generates its own, writes it to the appdata volume and says loudly to back it
  up — but only when the database holds no encrypted value, since every envelope
  names the key that wrote it. Three startup refusals follow, all at boot rather
  than at the first credential read. Rotation loses nothing
  (`SECRET_ENCRYPTION_KEYS_RETIRED` + `secrets:rewrap`, serving throughout);
  losing the key loses everything, so `secrets:reset` is guarded by a phrase.

  Also landed: `tenant_secrets` makes `geocoding_api_key`, `places_api_key` and
  `anthropic_api_key` per-community (Admin → API Keys), and
  `GET /admin/email/config` stopped returning the operator's Brevo key in
  plaintext on every page load — which would have undone the column encryption at
  the last hop.

  **Stage found what tests could not.** `/app/appdata` was unmapped in both the
  compose file and the Unraid template, so three container recreates produced
  three keys while the log said to back up a file that could not survive. Nothing
  was lost only because nothing was encrypted under them yet. Four documentation
  fixes came out of the same pass (an SMTP key is not an API key; an API key is
  not tied to a domain; DNS commands that work on Windows).

  Landed on this branch but belonging to other items: the invite auto-login fix,
  and five commits of `v2-10` email/legal branding — see that item's notes.
- **`v2-6` — Bootstrap/runtime config split + user tenant scoping**
  (2026-08-19, REQ-TENANT-01.4/01.5). `users` and `app_config` are tenant-scoped;
  email is unique per tenant, so one address holds a separate account in each
  community and login resolves against the tenant owning the URL. Cookies are
  host-only, `express-session` is gone, and every member-facing link resolves
  through `baseUrlFor()` rather than `APP_URL`.

  The config split turned out to be mostly *deciding*: which of ~45 variables is
  bootstrap, install, deployment, runtime or a secret is now declared in
  `env-classification.ts` with a spec holding it to `.env.example`. Three things
  fell out of writing it — bootstrap config was already down to eleven variables,
  `DB_MODE` is named by the requirement but was never implemented, and seventeen
  variables were documented nowhere at all (`AUTO_PROVISION` among them, which is
  why the first stage install needed it passed along out of band).

  What actually moved is contact identity: a community's `hello@`, `calendar@`
  and `noreply@` are its own, resolved most-specific-first with the env var as
  the deployment default. Every credential stayed in env, because `app_config`
  had no encryption at rest — which `v2-7` then built.

  Stage testing drove the rest of the item and found gaps no test would have:
  a newly created community had no way in at all, an adminless community was
  unrecoverable, there was no way to delete one, and the tenant dialog's hints
  rendered on top of the fields beneath them. Each is covered above.

  Two corrections worth remembering, both from Rob pushing back on my reasoning:
  a non-root service account was created `disabled` to prevent an escalation that
  was never reachable, and was created *at all* on the claim that it owned the
  deployment's writes in that community — which was false, since
  `audit_log.user_id` is nullable and nothing looks one up.
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
- **`v2-5` — Tenant-scoping Prisma Client Extension** (2026-08-14). `tenant_id`
  on 27 transactional models, 12 left global. The split is declared once in
  `api/src/common/tenant/tenant-scoped-models.ts` and is exhaustive over
  `Prisma.ModelName` at the type level, so a new model that nobody classified
  does not compile. Verified by `test/tenant-isolation.e2e-spec.ts`: two tenants
  on one client, at the Prisma level and over HTTP. Unit 146, e2e 670/31 files.

  It fails closed three independent ways — no tenant context throws, the
  sentinel `DEFAULT 0` on `tenant_id` is rejected by the foreign key so an
  escaped create dies at the database, and the four `@Cron` sweeps carry
  explicit `runUnscoped('<reason>')` waivers.

  Four traps, all of which cost real time: **Prisma promises are lazy**, so
  `runWithTenant(id, () => prisma.x.find())` builds the query in the context and
  runs it outside (production shapes are safe; it bit the test helpers);
  **Prisma rejects `where` on a to-one `include`**, so only to-many relations
  can be filtered and to-one hops rely on the foreign key; **Vitest runs every
  hook and test body in a sibling async context**, so no ALS store set in a
  setup file or `beforeEach` reaches the `it()`; and **raw SQL is not routed
  through extensions at all**.

  Also fixed: `member_achievements`/`member_points` unique keys were built on
  globally-unique ids, so one community's award blocked another's. And a
  regression this item introduced — `HardDeleteTask`'s audit write failed the
  new foreign key *silently*, since the task catches its own errors.

  **Not verified on stage** — `/v2-testing` was skipped deliberately, because
  the property needs two tenants and that needs v2-6. Its regression surface
  (14 hand-edited raw SQL statements) should ride along with v2-6's stage pass.

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
so far: **`docs/REQ-TENANT-01.md` — Tenant Foundation** (status: Draft; **fully
implemented as of `v2-8`** — `v2-1` through `v2-6` closed out every requirement
except REQ-TENANT-01.8 and 01.9, both added later, and `v2-8` landed both). Four
further requirements docs exist as of 2026-09-01 and are not implemented:
`REQ-VALIDATE-01` (v2-17), `REQ-CMS-01` (v2-18 to v2-23), `REQ-CITIES-01`
(v2-24) and `REQ-IMPORT-01` (v2-25). REQ-TENANT-01 remains the foundational doc
everything else depends on and defines the conventions the rest of v2 follows. Key decisions it locks in:

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

**After `v2-6` come secrets and per-tenant OAuth** — `v2-7` (encrypted secrets
at rest) then `v2-8` (per-tenant OAuth apps), moved ahead of the branding,
demo and wizard work with Rob 2026-08-15 and renumbered from the old
`v2-12`/`v2-13`.
The branding, landing page, demo, setup wizard and handbook items each shifted
down two, to `v2-9`–`v2-13`. Same reasoning as the `v2-2` move above: the
number is meant to read as the running order, and it was still free to change
because no `v2-*` tag above `v2-5` has been cut.

**Then per-community email sending, inserted as `v2-9` on 2026-08-21**, shifting
that same block down one more to `v2-10`–`v2-14`. Two more were inserted on
2026-08-30 — `v2-11` (a real colour system, next to the branding item because
they share a surface) and `v2-12` (OAuth callback on a community's own host, the
follow-on v2-8 deferred) — shifting the landing page, demo, wizard and handbook
down two again, to `v2-13`–`v2-16`. Still free: no `v2-*` tag above `v2-9`
exists. It was briefly folded into
`v2-7` and split back out: the encryption is what makes a per-tenant provider key
storable, but storing it is the small part next to scoping
`email_provider_config`, moving its seeding into `bootstrap.ts` and making the
dispatcher cron re-enter `runWithTenant` per message. Its stage pass also needs
real sends and real inbound webhooks, which `v2-7`'s does not.

**`v2-9` runs before `v2-8`, decided 2026-08-23 with Rob.** The numbers stay as
they are this time — `v2-7` is tagged, so renumbering around it would no longer
be free, and the running order is stated here instead. Neither item depends on
the other (`v2-8` needs `v2-6` and `v2-7`, both done; `v2-9` needs neither), and
what decided it was stage: it now runs two communities on two Brevo accounts,
which is precisely what `v2-9`'s stage pass needs. `v2-8`'s does not benefit —
the second community is email/password-only until `v2-8` itself lands. The
trigger was finding that a community admin on one host could rewrite the whole
deployment's sending credentials, since `email_provider_config` was global —
which `v2-9` then closed.

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
- **Auth:** JWT sessions + email/password, plus Google and Facebook OAuth using
  each tenant's own app credentials (`v2-8`). The Google Passport strategy is
  built per request, not registered once at boot.
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
  **Raw SQL is where scoping bugs hide** — it produces no compile error when a
  model becomes scoped, so a statement against a scoped table must carry its own
  predicate. A join hanging off an already-scoped row (a rating's member) does
  not need one, but should say so.
- **Global prefix** `/api/v1` set in main.ts
- **Never expose stack traces** — GlobalExceptionFilter handles all errors
- **Tenant scoping is automatic, not manual** (landed in `v2-5`) — never add a
  `tenant_id` filter by hand in a service. The Prisma Client Extension injects
  it, including into nested writes, nested `include`/`select`, relation counts
  and `connect`. The exception is **raw SQL**, which Prisma does not route
  through extensions: `$queryRaw`/`$executeRaw` against a scoped table must
  carry their own predicate, taking the id from `requireTenantId('<usage>')`.
- **System work that legitimately crosses tenants says so out loud** — wrap it
  in `runUnscoped('<reason>', ...)`. Without a tenant in context the extension
  throws rather than returning everything, so a forgotten context is a failure
  and not a leak.
- **Secrets are encrypted automatically, not manually** (landed in `v2-7`) —
  never call `encryptSecret`/`decryptSecret` in a service. A second Prisma Client
  Extension (`api/src/database/prisma/secret-encryption.extension.ts`) encrypts
  every column declared in `api/src/common/crypto/encrypted-columns.ts` on write
  and decrypts it on read, nested writes and relation includes included. Adding
  an encrypted column means adding it to that list. **Raw SQL is again the
  exception** — no `$queryRaw` site touches one today, and one that does must
  call the cipher itself. `rewrap-secrets.ts` deliberately uses a bare client for
  the opposite reason: rewrapping through the extension would be a no-op that
  reported success.
- **An encrypted column cannot be filtered, ordered, grouped or joined on** — the
  cipher is randomised, so the extension throws rather than letting the query
  return an empty result that reads as "no such key". Look the row up by another
  column and compare after decryption.
- **A stored credential never goes back out over HTTP.** `GET /admin/email/config`
  answers `brevoApiKeySet: boolean` (`email-config.view.ts`) and `/admin/secrets`
  reports only where each key resolves from. Decrypting at the database edge and
  re-exporting at the HTTP edge would put the value in an access log, a proxy
  buffer and a browser cache. The write direction is unchanged: an omitted key
  means "leave it alone", an explicit null clears it.
- **Never compare a role with `===` when asking "is this an admin"** — use
  `hasAdminRights`/`isElevatedRole` from `api/src/common/utils/roles.util.ts`
  (and the mirrored `frontend/src/app/core/utils/roles.util.ts`). `RolesGuard`
  knows `system_admin` implies `admin`, but it only guards *route access*; every
  in-handler comparison has to be told separately, and getting it wrong hides
  admin controls from the account with the most rights rather than erroring.

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
  reserved OAuth credential columns (nullable; the two `*_secret` ones are
  registered in `encrypted-columns.ts` as of `v2-7`, and written since `v2-8`).
- **NULL OAuth credentials mean that provider is OFF for the tenant**, which
  then offers email/password only — there is no platform-wide fallback app
  (REQ-TENANT-01.9, decided 2026-08-14; this *reversed* the original reading in
  REQ-TENANT-01.1, so ignore any older phrasing that says NULL means "uses the
  platform's own OAuth apps"). Live as of `v2-8`: the deployment-wide
  `GOOGLE_CLIENT_*`/`FACEBOOK_APP_*` env vars are **gone**, not kept as a
  fallback, so there is no configuration that can reintroduce one.
- **Which providers a tenant offers is answered by `GET /auth/methods`** —
  unauthenticated and tenant-resolved, since the login page has no session yet.
  `GET /auth/providers` cannot do it: it is `JwtAuthGuard`ed and reports the
  signed-in user's *linked* accounts, a different question.
  `TenantOAuthService.offeredProviders()` selects only `googleClientId` and
  `facebookAppId` — never the secrets — so answering it decrypts nothing.
- **The OAuth callback runs on one fixed host and hands the session back.**
  `state` is signed and carries the originating tenant; the callback writes a
  single-use `oauth_handoffs` row and redirects to that tenant's own host to
  redeem it. Two rules fall out: the tenant in a decoded `state` must be read
  **before** any error branch (a cancelled sign-in still has to know where to
  return), and the callback resolves a user belonging to a tenant other than the
  host's, so it runs inside an explicit `runWithTenant`.
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
- **Tenant scoping enforcement point is the Prisma Client Extension**
  (`api/src/database/prisma/tenant-scope.extension.ts`), not individual services
  or controllers. Which models it scopes is declared in
  `api/src/common/tenant/tenant-scoped-models.ts`, which is exhaustive over
  `Prisma.ModelName` at the type level — **a new model must be classified as
  scoped or global or the build fails**, and adding `tenant_id` in
  `schema.prisma` means adding it to that list in the same change.
- The tenant reaches the extension through **AsyncLocalStorage**
  (`tenant-store.ts`), established by `TenantMiddleware` around `next()`. Three
  states, deliberately distinct: a tenant, `null` (explicitly waived by
  `runUnscoped`), and no context at all — which throws. Note **Prisma promises
  are lazy**, so `runWithTenant(id, () => prisma.x.find())` runs the query
  *outside* the context; await inside the callback.
- **`users` and `app_config` are tenant-scoped as of `v2-6`.** Email is unique
  per tenant (`@@unique([tenantId, email])`), not globally, so one address can
  hold a separate account in each community and login resolves against the
  tenant that owns the URL. `oauth_accounts` is keyed
  `(tenant_id, provider, provider_id)` for the same reason.
- **`seed.ts` may only write tenant-independent reference data.** It runs before
  `bootstrap.ts` creates the root tenant, so a row it writes to a scoped table
  takes the `tenant_id` sentinel and is rejected by the foreign key. The
  `app_config` defaults and the automation account live in `bootstrap.ts` for
  exactly this reason; the install is still `migrate` -> `seed` -> `bootstrap`.
- **Links that leave the app must use the tenant's host**, via
  `TenantResolutionService.baseUrlFor()` — never `APP_URL`, which is one value
  for the whole deployment. Verification and reset emails, invite links, event
  links and calendar feeds all resolve tokens against scoped tables, so a link
  to the wrong host finds nothing and the flow fails silently. Pass an explicit
  tenant id inside a `runUnscoped` sweep, where there is no ambient one.
  `APP_URL` legitimately survives for the OAuth callback registered with Google,
  the "is this stage" check, and the cookie-clearing domain.
- **A cron sweep that composes per-tenant content must re-enter
  `runWithTenant`.** `runUnscoped` is right for *finding* rows across tenants and
  wrong for *rendering* anything: `app_config` is scoped, so branding read under
  a waiver returns whichever tenant the engine reached first. See the seats
  reminder in `events.service.ts`.
- **Email lookups are `findFirst`, not `findUnique`.** An address no longer
  identifies a row on its own. The exception is a compound unique key
  (`app_config`'s upserts), which Prisma will not let the extension merge a
  tenant into — those call `requireTenantId`, like raw SQL.
- **Roles as of `v2-6`:** `non_validated`, `member`, `moderator`, `admin`,
  `system_admin`, `automation`, `disabled`. `system_admin` is the deployment
  operator (tenant management); `SystemAdminGuard` requires the role **and**
  `req.tenant.isRoot`, and `admin.service.setRole` refuses to assign or remove
  it — bootstrap creates the first one, further ones are a database edit.
  `disabled` grants nothing at all, since `RolesGuard` is an allowlist.
- **A service account exists only where something can use it**
  (`tenantGetsServiceAccount`): the root tenant always, other communities on a
  **stage deployment only**. It used to be created everywhere, justified as
  owning the rows the deployment writes inside that community — which was false:
  `audit_log.user_id` is nullable and nothing looks a non-root one up. In
  production a customer community gets none at all.
- **`automationLogin` matches that**: root anywhere, non-root on stage only. A
  single platform-wide `CLAUDE_AUTOMATION_SECRET` would otherwise mint a session
  inside a customer's community. Gating on `IS_STAGE` means the capability cannot
  exist in production rather than existing behind a promise to disable it.
- **`isStageDeployment()` reads `process.env`, not `ConfigService`** — deliberate
  and the only flag that does. `bootstrap.ts`/`provision-tenant.ts` are plain
  node processes with nothing to inject from, and two services capture `IS_STAGE`
  in their constructors, which would make it untestable in both states.
- **The service account holds `automation` wherever it exists**, root or not. A
  community's own admin may change its role (it is inert — NULL password hash, so
  nothing can authenticate as it, and the actor is already an admin there).
  `system_admin` is the exception and stays guarded on both sides.
- **`users.is_service_account` marks the one non-human account per tenant.**
  Guards key on that column, never on the role (deliberately mutable — the root
  account gets flipped to admin and back for testing) and never on the
  address, which `v2-10` duly renamed to `automation@communityevents.internal`
  without anything breaking — that rename is the proof the column is the real
  key. It still needed a migration, because `createServiceAccount` upserts
  `ON DUPLICATE KEY UPDATE` against `(tenant_id, email)`, so an unrenamed
  deployment would have grown a *second* service account rather than updating
  its own. Service accounts cannot be deleted by any path and are hidden from
  the member directory and the leaderboard.
- **Nothing is deleted on a timer if it is an `admin`, a `system_admin` or a
  service account** (`AUTO_DELETE_ELIGIBLE`). The interactive paths already
  refused them; the scheduled sweeps were the gap, and `inactivityCheck`
  soft-deletes anything idle past 120 days and hard-deletes it 30 days later
  with no confirmation. Admins still get the 60/90-day re-engagement nudges —
  only the deletion stages exclude them.
- **Creating a tenant creates its first admin.** Without one a community is a
  dead end: registration needs an invite, invites need an existing member of that
  tenant, and its only other account is the `disabled` service account. The
  fields are create-only. A one-time setup link replaces the password hand-off in
  `v2-15`.
- **A new community is seeded with the platform's Terms and Privacy Policy**
  (`api/src/common/legal/legal-defaults.ts`), by `bootstrap.ts` for the root
  tenant and by `tenants-admin.service.create` for every other. `/terms` and
  `/privacy` render whatever `app_config` holds, and a missing row is not an
  error there — it is a titled page with nothing under it, which reads as
  answered. They are templates, not finished documents: `{{brand_name}}`,
  `{{legal_entity}}` and `{{support_email}}` are filled in on the **public read**
  (`getPublicValue`), never at seed time, so renaming a community does not
  strand its old name inside two documents nobody re-reads. The admin editor
  deliberately sees the raw copy.
- **`legal_entity` is deployment-wide (`LEGAL_ENTITY_NAME`), not per-community.**
  One operator runs every community on a deployment, and a community cannot
  accurately describe processing it does not control. Blank falls back to the
  community's own name, which is right only when the two are the same.
- **`legal_reviewed_at` is what says a human read them.** Empty until an admin
  confirms at Admin → Legal; until then every admin of that community sees a
  banner in the app shell. Seeding is what makes this necessary — the pages look
  finished, so nothing else would ever prompt a review. It rides in the branding
  payload so the banner costs no extra request.
- **`system_admin` is assignable from the UI to the root tenant's service account
  only, by someone who already holds it.** Both halves matter and neither implies
  the other: constraining only the target let any root-community admin mint the
  role that operates every community. Humans still cannot be promoted. The picker
  reads `isRoot` off the branding payload so it stops offering an option the API
  would refuse. Temporary — expected to revert to database-only before
  production.
- **`automationLogin` keys on `is_service_account` + the root tenant, never the
  role.** The account is deliberately flipped between roles for testing, so a
  role check locks automation out exactly when it is being used.
- **Which env vars are bootstrap and which are runtime config is declared in
  `api/src/common/config/env-classification.ts`**, one entry per variable with
  the reasoning, and a spec holds it to `.env.example` in both directions. Adding
  a variable to the sample env without classifying it fails the build, the same
  way an unclassified Prisma model does. Bootstrap is eleven variables and should
  stay that size; `DB_MODE` is named by REQ-TENANT-01.4 but was never
  implemented, and is not the same thing as the reserved `tenants.db_mode`
  column.
- **A community's contact addresses are per-tenant** (`mail_domain`,
  `contact_support_email`, `contact_calendar_email`, `contact_event_email` in
  `app_config`, edited in Site Settings). Resolve them through
  `AppConfigService.supportEmail()` / `.calendarOrganizerEmail()` /
  `.eventOrganizerEmail()`, never `instance-contact.ts` directly — those are the
  deployment-wide env layer underneath. Order is most-specific-first: the
  community's own address, then a derivation from its own mail domain, then the
  env var, then a derivation from the deployment domain. Blank means inherit, so
  an install that sets nothing is unaffected.
- **Tenant creation asks for the mail domain** (`CreateTenantDto.mailDomain`),
  writing it as an ordinary `mail_domain` row on the new tenant — the same
  setting its admin edits later, not a second home for the value. Create-only,
  like the first-admin fields. The dialog prefills the deployment's own mail
  domain when the new community is a subdomain of it, and deliberately suggests
  nothing otherwise.
- **The mail domain is never derived from the tenant's host.** A tenant is a web
  host; a tenant subdomain normally publishes no MX record, so
  `hello@dayton.example.com` would bounce silently. Same failure the `www.` strip
  guards against, one level down. Pass an explicit tenant id inside a
  `runUnscoped` sweep, as with `baseUrlFor()`.
- **A credential still never goes in `app_config`** — but the reason changed in
  `v2-7`. It is no longer that nowhere is safe; it is that `app_config` rows are
  served to unauthenticated visitors (the branding payload, the public
  `/config/:key`), so a secret there is one allowlist edit away from a public
  response. Per-community credentials live in **`tenant_secrets`**, a separate
  scoped table whose whole value column is encrypted.
- **Three secrets are per-community as of `v2-7`** — `geocoding_api_key`,
  `places_api_key`, `anthropic_api_key` (`tenant-secret-keys.ts`), resolved
  most-specific-first through `TenantSecretsService.resolve()` with the env var
  as the deployment default, and set at Admin → API Keys. Each is metered against
  whoever owns the key, which is the argument for per-community. The rest stay in
  env with a reason recorded per variable; the class is now called `secret`
  rather than `secret-pending-v2-7`. The mail *identity* (`BREVO_FROM_*`) stays
  with the email keys, and `v2-9` made both per-community in
  `email_provider_config` rather than in `tenant_secrets` — they move together
  because a provider rejects a From address on a domain that account has not
  verified.
- **The encryption key is bootstrap config and is never in the database** — a
  dump holding both the key and the ciphertext is a dump of the plaintext, which
  is the whole threat. `SECRET_ENCRYPTION_KEY`, `SECRET_ENCRYPTION_KEYS_RETIRED`
  and `SECRET_ENCRYPTION_KEY_FILE` took bootstrap from eleven variables to
  fourteen; the key is the one value that could not be runtime config even in
  principle, since it is what makes runtime config readable.
- **A fresh deployment generates its own key** (`secret-key-bootstrap.ts`, run
  from `main.ts` after the database is reachable), writes it to the key file on
  the appdata volume, and logs loudly that it needs backing up. Generating is
  allowed **only when the database holds no encrypted value** — what the data
  contributes is not the key but a constraint on it, since every envelope names
  its key id. Three refusals follow from that, all at startup rather than at the
  first credential read: no key with secrets present, a key that cannot read
  what is stored, and (a warning, not a refusal) data still under a retired key.
  Legacy plaintext names no key, so a pre-`v2-7` database still generates
  cleanly.
- **Rotation loses nothing; losing the key loses everything.**
  `SECRET_ENCRYPTION_KEYS_RETIRED` plus `npm run secrets:rewrap` moves every
  value onto a new key with the deployment serving throughout. If the key is
  genuinely gone, `npm run secrets:reset` is the explicit destructive recovery —
  it NULLs every encrypted column so a new key can be generated, guarded by a
  confirmation phrase rather than a boolean for the same reason deleting a
  community makes you retype its domain. `docs/SECRETS.md` is the operator-facing
  version; `docs/TENANT_ONBOARDING.md` covers the provider-side setup.
- **Email sending is per-community as of `v2-9`.** `email_provider_config` is
  scoped: its Brevo key, From identity, template ids, webhook token and daily
  counters all belong to a community, resolved with the env credentials as the
  deployment default. A cron that sends must therefore re-enter `runWithTenant`
  per message — the dispatcher groups its batch by `tenantId` for exactly this
  reason, since sending the whole batch under one config mails every community
  through whichever account the engine loaded first. **Template ids are scoped
  too**, so a newly created community has none and falls back to
  `BREVO_TEMPLATE_*`; set those on the deployment or every new community sends
  the raw-HTML fallback, which works and therefore goes unnoticed.
- **A provider's daily allowance belongs to the ACCOUNT, not the community.** A
  community with no key of its own sends on the deployment's, so several share
  one Brevo account and one allowance. Two of them each counting only their own
  sends against their own limit of 300 will spend 350 of one 300/day account and
  be cut off having never exceeded what either believed was its budget. So there
  are two numbers and they answer different questions: `brevoSentToday` is
  attribution and is never overwritten by the provider, while the account budget
  (`BrevoService.getAccountQuota`, cached against a hash of the API key) is what
  gates sending. Both must allow a message. Only a `free` plan reports a daily
  figure — a prepaid balance has no daily cap, and treating it as one would stop
  sending at an imaginary line.
- **`EMAIL_QUOTA_TIMEZONE` is the operator's calendar day, not the provider's.**
  It was built to mirror the provider's reset, which turned out to be
  unknowable: `GET /v3/account` has no timezone field, and separate accounts can
  reset on separate cycles, so one deployment-wide setting could not match them
  all. The account budget above is what makes that safe to accept — a send needs
  both budgets, so a local counter that zeroes mid-provider-day cannot overshoot.
  What the setting decides is only which day a human reading the screen is
  looking at. `quotaDayStart` takes the offset in force at midnight rather than
  the one in force now, so a DST changeover day does not sit an hour out for its
  whole length.
- **Tenant management lives at `/api/v1/system/tenants`**, under `system/` and
  not `admin/` because it acts on the registry of communities rather than inside
  one. The root tenant cannot be suspended and its domain cannot be changed
  there — both would lock the system admin out of the only host the API answers
  on.
- **Deleting a community passes three gates**: never the root tenant, it must
  already be `suspended`, and the caller retypes its domain. Suspending stays the
  ordinary way to take one offline. The purge filters by `tenantId`
  **explicitly** rather than through the extension — the one place in the
  codebase that should — because a `deleteMany({})` that silently lost its filter
  would empty every community, and a transaction client is not somewhere to bet
  on an extension being applied. Order does not matter (every FK among scoped
  tables is `CASCADE`); the `tenant_id` keys stay `RESTRICT` so the final
  `tenants.delete()` fails loudly if the model list ever misses a table.
- **A community's people are managed from the root tenant** at
  `/api/v1/system/tenants/:id/users` — list, add, change role, suspend, set
  password. Necessary because a system admin holds no account in the communities
  they administer and those admin screens live on each community's own host, so
  an admin who left or forgot their password made a community unreachable. It
  refuses to touch a **service account** or any **system_admin**, and cannot
  grant `system_admin`, matching `admin.service.setRole`.
- **System-admin actions on other communities are audited on the ROOT tenant.**
  `audit_log` is itself scoped, so an entry written against the community would
  be deleted along with it (for a delete) and would hand that community's admin
  an edit history of the operator (for everything else). The community id goes in
  the metadata.

**Cookie scoping — fixed in `v2-6`.** The session cookie is **host-only**: no
`Domain` attribute, so it belongs to the exact tenant host that issued it. It
previously carried `domain: BASE_DOMAIN`, which under v2 meant one login valid
across every tenant, since `.example.com` covers all of them. `BASE_DOMAIN` is
now only the mail domain, plus clearing pre-`v2-6` cookies. Options live in
`api/src/common/utils/auth-cookie.util.ts` — never set a `domain` there.

One consequence, **closed by `v2-8`**: Google's callback lands on a single fixed
host, so a host-only cookie set there does not reach a different tenant's host.
REQ-TENANT-01.8's signed `state` plus the single-use `oauth_handoffs` ticket
carry the session back to the originating host, so OAuth now works on every
tenant that has credentials. **`SameSite=strict` survives that redirect** — it
was expected to need `lax` and does not, because SameSite decides whether a
cookie is *attached* to a request, not whether one can be *set* in a response.
Don't loosen it on the theory that the handoff needs it.

**`express-session` is gone, and `SESSION_SECRET` with it** (`v2-6`). The
comment claiming a session was "required by passport-google-oauth20" was wrong
for this configuration: `GoogleStrategy` does not pass `state: true`, so
passport-oauth2 picks its `NullStore`, whose `store()`/`verify()` never touch
`req.session` and whose `verify()` returns true unconditionally. Nothing else
read `req.session`. So the middleware only minted a `connect.sid` cookie per
visitor and leaked a MemoryStore entry per request. Removing it changes no
behaviour — `state` was already unverified, and REQ-TENANT-01.8's signed state
(`v2-8`) was the real fix and landed there, needing no store either. `SESSION_SECRET` can be
dropped from any `.env`; nothing reads it.

**The v1 design note this replaced, kept because the reasoning still explains
the shape of the problem:** v1 runs `BASE_DOMAIN=www.dinnerbears.com` in prod
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
