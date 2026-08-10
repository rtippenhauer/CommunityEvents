# REQ-TENANT-01 — Tenant Foundation

**Project:** Community Events (formerly DinnerBears 2.0)
**Area:** Core platform / multi-tenancy
**Status:** Draft
**Depends on:** none (this is the foundational doc — everything else depends on it)

## Summary

Establish the tenant data model, domain-based tenant resolution, and the
Prisma data-access layer (replacing TypeORM) with tenant scoping built in
from the start, plus the testing stack (Vitest/Supertest/Playwright
replacing Jest and Karma/Jasmine) that the rest of v2 is written against.
This is the first requirements doc for Community Events and defines
conventions the rest of the project follows.

## Background

DinnerBears currently serves two user bases by running two full duplicate
deployments (separate container, separate database) with settings-driven
branding (icon/name/terms via `app_config`). Community Events replaces that
manual pattern with a single deployment, single database, and tenant-scoped
data — new tenant = a database row, not a new deployment.

## Implementation order

Build in this sequence, not requirement-number order — the data layer has
to exist before tenant scoping has anything to scope:

1. **REQ-TENANT-01.3 first** (Prisma swap) — install Prisma, model
   `schema.prisma` against the existing DinnerBears schema
   (`docs/DATABASE_SCHEMA.md`) as a starting point, wire up `PrismaService`
   in place of `TypeOrmModule`, remove TypeORM entities/decorators and the
   `@nestjs/typeorm` dependency once everything compiles against Prisma.
   Confirm this works end-to-end (app boots, existing queries run) before
   moving on.
2. **REQ-TENANT-01.6** (testing stack swap) — replace Jest and
   Karma/Jasmine with Vitest + Supertest + Playwright before any tenant
   feature work starts. Same class of task as the Prisma swap: foundational
   tooling replacement that everything after it is written against. Doing
   it here means tenant code is written under the target stack from its
   first line, rather than being written against Jest and ported later.
3. **REQ-TENANT-01.1** (tenants table) — add the table and seed the root
   tenant, now that Prisma is the working data layer.
4. **REQ-TENANT-01.2** (domain resolution middleware) — build against the
   now-existing tenants table.
5. **Tenant-scoping Client Extension** (part of REQ-TENANT-01.3, built
   last within that requirement) — add once the base Prisma setup and
   tenants table are both confirmed working; easier to verify scoping
   against a known-good baseline than to build both at once.
6. **REQ-TENANT-01.4** (bootstrap vs. runtime config) and
   **REQ-TENANT-01.5** (user tenant scoping) — last, since both depend on
   tenants existing and domain resolution working.

## Requirements

### REQ-TENANT-01.1 — Tenants table

- `tenants` table: `id`, `slug`, `domain` (unique), `is_root` (boolean),
  `status` (enum: active/suspended), `db_mode` (enum: shared/dedicated —
  reserved for future use, defaults to `shared`), `created_at`
- `google_client_id`, `google_client_secret`, `facebook_app_id`,
  `facebook_app_secret` — all nullable, secrets encrypted at rest, reserved
  for future use in the same sense as `db_mode` and read by no code in this
  doc. Null is the default and the only value REQ-TENANT-01.8 contemplates:
  it means the tenant uses the platform's own OAuth apps. See
  REQ-TENANT-01.8 for why a tenant might eventually supply its own.
- Exactly one tenant has `is_root = true`. This tenant's domain matches
  `ROOT_TENANT_URL` from bootstrap config (see REQ-TENANT-01.4). Its admin
  is the system admin.
- `www.<domain>` and `<domain>` normalize to the same tenant record
  (strip `www.` before lookup; do not create separate rows).

### REQ-TENANT-01.2 — Domain resolution middleware

- NestJS middleware runs before all route handlers, resolves `tenant_id`
  from the request `Host` header, and attaches it to the request context
  (e.g. `req.tenantId`).
- Unrecognized domains return a clear 404 (not a generic error), so
  misconfigured DNS is easy to diagnose.
- Middleware result is cached briefly (e.g. in-memory, short TTL) to avoid
  a DB lookup on every request — tenant records change rarely.
- Subdomains not yet in the `tenants` table (future `sub1.baseurl` pattern)
  fall through to the same 404 handling; no special-casing needed yet since
  sub-communities are out of scope for this doc.

### REQ-TENANT-01.3 — Prisma data layer with tenant scoping

- Replace TypeORM entirely. `schema.prisma` is the single source of truth
  for the data model going forward.
- `PrismaService` (injectable, extends `PrismaClient`) replaces
  `TypeOrmModule` as the shared data-access point.
- A Prisma Client Extension auto-injects `tenant_id` into `where` clauses
  on all tenant-scoped models, and auto-sets `tenant_id` on create — this
  is the single enforcement point for tenant isolation, not something each
  service remembers to do manually.
- Models explicitly marked as **global** (not tenant-scoped) — e.g. the
  `tenants` table itself, and any true cross-tenant system-admin data —
  are excluded from the extension by convention (e.g. a naming pattern or
  explicit allowlist).
- Migration workflow: `prisma migrate dev` locally, `prisma migrate deploy`
  in CI/deploy. Replaces TypeORM's manual migration files.
- Seed strategy: `prisma/seed.ts` creates the root tenant on first run if
  none exists (ties into the setup wizard from a later doc).

### REQ-TENANT-01.4 — Bootstrap vs. runtime config

- Bootstrap config (env vars, set once at container start): `DB_MODE`
  (bundled/external), DB connection details if external, `ROOT_TENANT_URL`.
  Minimal by design — everything else is runtime-configurable.
- Runtime config (DB-backed, editable via UI once the app is running):
  everything else, including the existing `app_config` branding pattern,
  now made tenant-aware (`tenant_id` column added, `tenant_id = null` or a
  root-tenant fallback for true global/system settings).
- This doc does not implement the settings UI itself — that's a follow-up
  doc — but the schema decision (tenant-scoped `app_config`) is made here
  since other docs will build on it.

### REQ-TENANT-01.5 — User tenant scoping

- `users.tenant_id` — single FK, not a join table. A user belongs to
  exactly one tenant (per earlier decision — sub-communities/multi-tenant
  membership deferred, not designed in).
- Auth (Google/Facebook OAuth, email/password) resolves within the
  requesting tenant's context — a user record is unique per
  `(tenant_id, email)`, not globally unique by email alone.

### REQ-TENANT-01.6 — Testing stack replacement

- Replace Jest (`api/`) and Karma/Jasmine (`frontend/`) with **Vitest** as
  the single test runner across both workspaces. Like the Prisma swap, this
  is a full replacement, not a side-by-side migration — Jest and
  Karma/Jasmine dependencies and config are removed once the existing suites
  pass under Vitest.
- **Supertest** for API integration tests against the running Nest
  application, replacing Jest's `@nestjs/testing` + Supertest pairing only
  insofar as the runner changes; the Nest testing module itself stays.
- **Playwright** replaces Karma's browser harness for e2e. Scaffold and
  wire it into the repo here; per the testing requirements below there is
  no standalone tenant e2e spec to write yet, so a smoke spec proving the
  harness runs is sufficient for this step.
- Existing inherited tests are ported, not deleted. If a given inherited
  suite is too tied to Jest/Karma internals to port cheaply, it may be
  dropped — but that has to be called out explicitly rather than done
  silently, so the coverage loss is a decision and not an accident.
- Sequenced immediately after the Prisma swap and before the `tenants`
  table so that all tenant code — and its tests — is written against the
  target stack from the start.

### REQ-TENANT-01.7 — Domain scheme (decided 2026-08-09)

The doc previously left the v2 domain scheme open. It is now settled by the
project having its own domain, `communityeventsproject.com`:

- The root tenant is `www.communityeventsproject.com`. `www.` and the apex
  resolve to that same tenant row, per REQ-TENANT-01.1 — never two rows.
- An admin on the root tenant is the system admin.
- Additional tenants are subdomains of the same apex
  (`demo.communityeventsproject.com`, and later real communities).
- `stage.` is a **separate deployment**, not a tenant of production: its own
  container, database and root tenant. Being a subdomain of the same apex
  makes it look like a tenant; it is not one.

**Auth cookies must be scoped to the exact tenant host, never to a shared
parent domain.** A cookie issued for `.communityeventsproject.com` is sent to
every tenant subdomain, so a session created on one tenant would authenticate
its holder on all of them -- defeating the isolation the Client Extension
exists to enforce. This is the inverse of the v1 `BASE_DOMAIN` problem: v1
scoped cookies too narrowly and lost sessions on subdomains; scoping them to
the apex here would share sessions across tenants, which is far worse than
losing them. Domain resolution (REQ-TENANT-01.2) and the tenant-scoping
extension (REQ-TENANT-01.3) both depend on getting this right.

### REQ-TENANT-01.8 — OAuth callback host (design constraint, decided 2026-08-09)

Google and Meta both require every OAuth redirect URI to be **registered in
advance** in their developer consoles, and neither supports a subdomain
wildcard. v1 lists them one per city:

```
https://dinnerbears.com/api/v1/auth/facebook/callback
https://cincinnati.dinnerbears.com/api/v1/auth/facebook/callback
https://dayton.dinnerbears.com/api/v1/auth/facebook/callback
```

That directly contradicts this project's premise that a new tenant is a
database row rather than a deployment. Left as-is, onboarding a community
means an operator hand-editing two third-party consoles before any of its
members can log in, and a tenant created at 2am cannot use social login until
someone wakes up.

**All OAuth callbacks therefore terminate on a single fixed host** — the root
tenant, `www.communityeventsproject.com` — regardless of which tenant the
login started from. One redirect URI per provider, registered once, never
touched again as tenants come and go.

The complication this creates, and the reason it is written down rather than
left to implementation: the callback lands on the root host, but the session
belongs to the *originating* tenant, and REQ-TENANT-01.7 requires the session
cookie to be scoped to that tenant's exact host. The callback cannot simply
set a cookie — it is on the wrong domain to do so. The handoff needs:

- the originating tenant carried through the provider round-trip (the OAuth
  `state` parameter is the normal place, and it must be signed or otherwise
  unforgeable, since it decides which tenant the resulting session belongs to);
- a single-use, short-lived token issued by the callback and redirected to the
  originating tenant's host, which exchanges it there for a session cookie
  scoped to that host.

Getting the `state` handling wrong here is a cross-tenant account takeover, not
a login bug: an attacker who can choose the tenant in the callback chooses
which tenant a freshly authenticated session is issued for.

**Half of this already exists in the inherited codebase and should be read
before it is redesigned.** v1 solves the routing problem exactly this way:
`GoogleStrategy` captures the originating `Host` into the OAuth `state` on the
outbound redirect and decodes it back out in `validate()`
(`api/src/modules/auth/strategies/google.strategy.ts`), and the callback
refuses any host outside the configured base domain before putting it in a
`Location` header (`AuthController.isAllowedRedirectHost`). What v1 has no
equivalent of is the handoff — it sets the session cookie on the callback host
with `domain: this.baseDomain` (`AuthController.accessTokenCookieOptions`),
and that option's own comment states the shared scope is required *because*
the round-trip lands on a different host. That single line is the one
REQ-TENANT-01.7 forbids. Replacing it, rather than rebuilding the `state`
plumbing around it, is the substance of this requirement.

Two things the v1 mechanism does need in v2: `state` becomes signed (v1's is
plain base64url, safe only because the allowlist is one hardcoded domain), and
the redirect target is resolved from a signed tenant id looked up in `tenants`
rather than from a host string carried in the payload.

**The callback executes in the wrong tenant's context.** Domain resolution
(REQ-TENANT-01.2) resolves the callback request to the *root* tenant, because
the root host is where it arrives, while the user record it must find or create
belongs to the originating tenant. Under per-tenant email uniqueness
(REQ-TENANT-01.5) that is a correctness problem rather than a tidiness one —
the same address can legitimately exist in both tenants, and the wrong context
resolves to the wrong person. The tenant-scoping Client Extension
(REQ-TENANT-01.3) therefore needs an explicit, documented "run this block as
tenant X" override, and the OAuth callback is its first legitimate consumer. It
has to be an intentional and auditable escape hatch, not the callback quietly
bypassing the extension, or it dissolves the single enforcement point the
extension exists to be.

**Cookie `SameSite` very likely has to relax from `strict` to `lax`.** The
session cookie is set on the tenant host during a redirect chain that began
cross-site on the root host, and browsers withhold `SameSite=Strict` cookies
from requests arriving via a cross-site redirect. The first request after the
handoff would then land unauthenticated, making a successful login look like it
did not take. `lax` is the conventional setting for OAuth returns and is
sufficient here. v1 currently ships `strict`; confirm the real behaviour in a
browser rather than trusting a reading of the spec.

**Consent-screen branding is accepted as platform-branded.** Google and Meta
both render the app name and logo from the OAuth client's own project, not from
the redirect URI, so a member signing in at any tenant sees "Community Events"
on the consent screen rather than their own community's name. A tenant-branded
page immediately before the redirect softens the transition, but the consent
screen itself cannot be varied per tenant within a single client, and v2 does
not try to.

The constraint underneath it is the stronger argument for a fixed callback host,
and the reason this is recorded as a decision rather than a cosmetic footnote:
Google requires a redirect URI's domain to appear as a verified **Authorized
domain** on the consent screen, verified by the owner of the project. For a
tenant that brings its own domain instead of a subdomain of the apex,
registering their callback URI is therefore not merely tedious but impossible.
Terminating every callback on a domain this project owns is the only
arrangement that works for such a tenant at all.

**Reserved, not designed:** the nullable per-tenant OAuth credential columns on
`tenants` (REQ-TENANT-01.1) exist for a tenant that eventually wants its own
consent-screen identity. Null means the platform's apps and the handoff above.
Populated would mean the tenant registered its own app — and because a tenant
owning its domain can verify that domain, it could receive the callback on its
own host and skip the handoff entirely. That second code path is deliberately
left undesigned until someone asks for it. DinnerBears is the concrete case
whenever it is designed: it already has registered Google and Facebook apps, so
reusing them as that tenant's credentials would both preserve the identity its
members already recognise and spare every existing user a fresh consent prompt
caused by the app changing underneath them.

## Testing requirements

Per the project's testing conventions (Vitest + Supertest + Playwright),
established by REQ-TENANT-01.6 above:

- **Unit (Vitest):** domain resolution logic (Host header parsing, `www.`
  normalization, unrecognized-domain handling), Prisma tenant-scoping
  extension (verify a query without explicit tenant filtering still comes
  back scoped correctly).
- **Integration (Supertest):** a request against Tenant A's domain never
  returns Tenant B's data, even when IDs collide across tenants. Root
  tenant resolves correctly from both `domain` and `www.domain`.
- **E2E (Playwright):** not applicable at this layer — tenant resolution
  is exercised implicitly by every other E2E test once tenants exist, not
  tested standalone in the browser.

## Out of scope (deferred to later docs)

- Sub-community / sub-tenant model (`sub1.baseurl`)
- Setup wizard UI
- Tenant/system-admin settings UI
- Dedicated-container-per-tenant option (schema field reserved, not built)
- Per-tenant OAuth app credentials and the direct-callback path they would
  allow (columns reserved, not built — see REQ-TENANT-01.8)

## Definition of done

- `tenants` table exists with root tenant seeded on first run
- Domain resolution middleware correctly resolves tenant from `Host` header
  for root domain, `www.` variant, and returns 404 for unrecognized domains
- TypeORM fully removed; Prisma is the only data-access layer
- Jest and Karma/Jasmine fully removed; Vitest is the only test runner,
  Playwright is wired up and running, and inherited suites either pass under
  Vitest or have had their removal explicitly called out
- Tenant-scoping Prisma extension verified via integration test (cross-tenant
  data leakage impossible even with colliding IDs)
- `users.tenant_id` enforced; duplicate email allowed across tenants, blocked
  within a tenant
- All new code covered by unit and integration tests per the testing
  requirements above
