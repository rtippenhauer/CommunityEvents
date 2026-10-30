# CommunityEvents — Claude Code Project Context

Community dining platform organising recurring group dinners. This repo is the
**v2.0 rewrite** of DinnerBears, a separate GitHub repo from v1 (still deployed
from the sibling checkout `../DinnerBears`).

**Never build or push `rtippenhauer/community-events:stage` or `:latest`** —
those are the live v1 deployment. This repo publishes **only** `:v2-stage`, via
`scripts/publish-v2-stage.sh`.

**Before reading a file over 300 lines, grep or Read with offset/limit; never
load whole large files into context.**

**Detail lives elsewhere and is not restated here.** `V2_PHASES.md` — per-item
history, decisions, running order, current status, deferred work.
`docs/REQ-TENANT-01.md` (foundational) and
`docs/REQ-{VALIDATE,CMS,CITIES,IMPORT,JOURNAL}-01.md` — requirements.
`docs/CUTOVER_PLAN.md` — cutover, v1 drift, inbound mail. `docs/SECRETS.md`,
`docs/TENANT_ONBOARDING.md`, `docs/DATABASE_SCHEMA.md` (non-authoritative).

## Product model

- **One deployment, one database, tenant-scoped.** A tenant is a community and
  is a database row — not a container or a database.
- **A city is a row inside a tenant**, not a hostname and not a subdomain.
- **Stage and prod are the only two environments**, each with its own database.

## Stack

Angular 22 (standalone components, no NgModules; Angular Material MDC; SCSS) ·
NestJS with **Prisma 7** and Passport, global prefix `/api/v1` · MySQL (stage
runs 9.7) · JWT + email/password plus per-tenant Google and Facebook OAuth ·
Brevo email with Resend overflow · Web Push + VAPID · Docker Compose behind
NGINX Proxy Manager, with no public ports on api or mysql.

**Testing is Vitest everywhere** (Jest, ts-jest, Karma and Jasmine are
uninstalled): `api/` has `vitest.config.mts` for unit specs and
`vitest.config.e2e.mts` for the Supertest suites in `api/test/`; `frontend/`
uses Angular's `unit-test` builder; `e2e/` is Playwright at the repo root.

## Branching & release

v2 work runs through `/v2-start <N>` → `/v2-testing <N>` → `/v2-done <N>`
(branch `v2-<N>-<slug>`, tag `v2-<N>`; only `/v2-done` touches `main`). Ad hoc
work still needs a branch — reuse the current item's, else `bugfix-<slug>` /
`chore-<slug>` — merged by PR with a real merge commit, **never squashed**.
`package.json`'s version is still v1's; routine v2 work does not bump it.

**Stage lives at `stage.communityeventsproject.com` in the Unraid container
`CommunityEvents-v2-Stage`. Run `/stage` before shelling in, deploying or
diagnosing it** — the image is Alpine with no `bash`, and the entrypoint starts
the app even when a migration fails.

## Angular conventions (STRICT)

- Standalone components only; Reactive Forms only; Signals for local state;
  functional route guards (`CanActivateFn`); each feature a lazy route group;
  an Angular Material component wherever one exists
- Typed services for all HTTP — never call `HttpClient` from a component
- **Never write a colour literal in a component** — use a `--ce-*` token, named
  for its job (`--ce-chrome` is the nav) rather than its colour, with the
  matching measured `--ce-on-*` for text on it. Success/error tints and
  third-party brand colours are the only exceptions.
- **`core/utils/palette.ts` is the only place colours are derived, and it is
  pure** — no DOM, so the admin preview renders exactly what it writes.

## NestJS conventions (STRICT)

- One module per feature; DTOs with class-validator; guards on every protected
  route — never trust client role state. **Never expose stack traces**;
  `GlobalExceptionFilter` handles all errors.
- **Prisma for all data access.** Raw SQL only where Prisma cannot express the
  statement, with a comment saying why.
- **Tenant scoping is automatic — never add a `tenant_id` filter by hand.** The
  Client Extension injects it, nested writes and includes included. **Raw SQL
  is the exception** and must carry its own predicate from
  `requireTenantId('<usage>')` — it produces no compile error when a model
  becomes scoped, which is where scoping bugs hide.
- **Work that crosses tenants says so** — `runUnscoped('<reason>', ...)`. No
  context at all throws, so a forgotten context fails rather than leaks.
- **Secrets are encrypted automatically** by a second extension — never call
  `encryptSecret`/`decryptSecret`; a new encrypted column goes in
  `common/crypto/encrypted-columns.ts`. **An encrypted column cannot be
  filtered, ordered, grouped or joined on** (the cipher is randomised): look
  the row up by another column and compare after.
- **A stored credential never goes back out over HTTP** — answer
  `<thing>Set: boolean`. On write, an omitted key means "leave it alone", an
  explicit null clears it.
- **A boolean DTO accepts any non-empty string as `true`**, because
  `enableImplicitConversion` coerces before validation. Where it matters, read
  the raw value with `@Transform(({ obj }) => obj.field)` so a non-boolean 400s.
- **Never compare a role with `===`** — use `hasAdminRights`/`isElevatedRole`
  from `common/utils/roles.util.ts` (mirrored in `core/utils/roles.util.ts`).
  `RolesGuard` knows `system_admin` implies `admin`, but only for route access.

## Database

`api/prisma/schema.prisma` is the single source of truth.

- **Fresh install is `migrate deploy` → `seed.js` → `bootstrap.js`, in that
  order** (`docs/NEW_INSTANCE_SETUP.md`). **`seed.ts` may only write
  tenant-independent data** — it runs before any tenant exists, so a row it
  writes to a scoped table takes the `tenant_id` sentinel and is rejected by
  the foreign key.
- **Prisma 7:** no `url` in the datasource block (it is in `prisma.config.ts`),
  and the client takes the `@prisma/adapter-mariadb` adapter — the MySQL one,
  despite the name. **`allowPublicKeyRetrieval` is required**, or every query
  fails as a "pool timeout" that never mentions authentication.
- **Prisma promises are lazy** — `runWithTenant(id, () => prisma.x.find())`
  builds the query in context and runs it outside. Await inside the callback.
- **Scalar fields are camelCase with `@map`**; a field name here IS the JSON key
  the frontend consumes. **DATE/TIME columns come back as `Date`** — convert
  with `prisma-date.util.ts`, never by string-slicing, and check write
  responses, not only the GETs that follow them.
- **No migration here is tested against populated data** by the suite — the e2e
  harness builds an empty database. Test data-moving migrations by hand.

## Multi-tenancy

**Resolution.** `TenantMiddleware` runs ahead of every route and sets
`req.tenant` — read it rather than re-resolving.

- `domain` is stored bare and lower-cased and **cannot hold a `www.` prefix**;
  use `normalizeTenantDomain` for any Host-header lookup.
- Exactly one tenant has `is_root`, enforced by a unique index on the nullable
  `root_marker`. **Write `is_root` and `root_marker` together, always.**
- A route that must answer without a tenant goes in `UNSCOPED_PATHS` — a string
  compare on `req.originalUrl`, because a wrong `exclude()` pattern fails open.
  Inside middleware `GlobalExceptionFilter` does not apply and `req.path` is
  `/`, so write the JSON body directly and read `req.originalUrl`.

**Scoping.** Enforced by
`api/src/database/prisma/tenant-scope.extension.ts` via AsyncLocalStorage.

- Scoped models are declared in `common/tenant/tenant-scoped-models.ts`,
  **exhaustive over `Prisma.ModelName` at the type level — a new model must be
  classified or the build fails.**
- **Email lookups are `findFirst`, not `findUnique`** — an address no longer
  identifies a row on its own. Compound unique keys call `requireTenantId`.
- **Links that leave the app use `baseUrlFor()`**, never `APP_URL`; pass an
  explicit tenant id inside a `runUnscoped` sweep.
- **A cron that composes per-tenant content must re-enter `runWithTenant`** —
  `runUnscoped` is for *finding* rows across tenants, never for *rendering*.
- **Deleting a community** passes three gates (never root, already suspended,
  caller retypes the domain) and the purge filters by `tenantId` explicitly
  rather than trusting the extension.
- **System-admin actions on other communities are audited on the root tenant** —
  `audit_log` is itself scoped.

**Identity.** Roles are `non_validated`, `member`, `moderator`, `admin`,
`system_admin`, `automation`, `disabled`. `SystemAdminGuard` requires the role
**and** `req.tenant.isRoot`; `setRole` refuses to assign or remove
`system_admin`.

- **Guards key on `users.is_service_account`**, never on role (deliberately
  mutable) and never on the address. A community may hold several service
  accounts, so no guard may assume one row per community.
- A non-person account's address is `<local>@<tenant slug>.internal` — the
  **slug**, so it survives a host change. Changing what it computes without
  migrating stored rows grows a second account rather than renaming one, so
  code change and rename migration ship together.
- Scheduled deletion never touches an `admin`, a `system_admin` or a service
  account (`AUTO_DELETE_ELIGIBLE`). **Creating a tenant creates its first
  admin**, without which a community is a dead end — registration is
  invite-gated.

**Cookies.** The session cookie is **host-only — never set a `domain`** in
`common/utils/auth-cookie.util.ts`, or one login is valid across every tenant.
`SameSite=strict` survives the OAuth handoff; don't loosen it.

**OAuth** (detail in `docs/REQ-TENANT-01.md` .8/.9). Each tenant brings its own
credentials and **NULL means that provider is off** — there is no platform-wide
fallback app. **Connecting a provider is a different route from signing in with
one** and takes the user from the session, carrying the user id in the
**signed** `state`, never a query parameter. The callback branches on where it
landed (`req.tenant?.id === state.tenantId`), never on a stored flag.

**Configuration and secrets** (`docs/SECRETS.md`, REQ-TENANT-01.9).

- **Whose domain a community is on decides its fallbacks, and it is derived,
  never stored** (`isOnDeploymentDomain`): on a subdomain of this deployment it
  may fall back to the deployment's Google and Brevo credentials, on its own
  domain it must bring its own. The suffix match carries a dot; the root tenant
  is answered by `is_root`. **The fallback has three copies** (`BrevoService`,
  `ResendService`, `BrevoWebhookService.register`) — gate a new one too.
- **A credential never goes in `app_config`** — those rows are served to
  unauthenticated visitors. Per-community credentials live in `tenant_secrets`,
  and **the encryption key is bootstrap config, never in the database.**
- Env vars are classified in `common/config/env-classification.ts`, held to
  `.env.example` by a spec both ways — **an unclassified variable fails the
  build.**
- **The mail domain is never derived from a tenant's host**, and **a deployment
  below the apex must set `BASE_DOMAIN` to the apex** — with no MX a sender
  falls back to the A record, so replies time out instead of being refused.
  Contact addresses resolve most-specific-first through `AppConfigService`;
  blank inherits.

**Email.** `email_provider_config` is scoped, so the dispatcher groups its batch
by `tenantId`. **A provider's allowance and its template ids belong to the
ACCOUNT, not the community**, so both the local counter and the account budget
must permit a send and an inherited template id addresses the wrong library. A
community on its own domain has **no email fallback** — fatal where the OAuth
equivalent is not, since registration, verification and resets are all mail.

**Also scoped:** `users`, `app_config`, `achievements`. An achievement's `key`
is an identifier joined on in code, not copy, so raw SQL joining the catalogue
needs its own `tenant_id` predicate.
