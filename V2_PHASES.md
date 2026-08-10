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
**Status:** In Progress

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

## v2-3 — Tenants table (REQ-TENANT-01.1)
**Status:** Not started

Add the `tenants` table and seed the root tenant, now that Prisma is the
working data layer.

**Definition of done:** `tenants` table exists with root tenant seeded on
first run.

## v2-4 — Domain resolution middleware (REQ-TENANT-01.2)
**Status:** Not started

NestJS middleware resolving `tenant_id` from `Host` header, built against
the now-existing tenants table.

**Definition of done:** Domain resolution middleware correctly resolves
tenant from `Host` header for root domain, `www.` variant, and returns 404
for unrecognized domains.

## v2-5 — Tenant-scoping Prisma Client Extension (REQ-TENANT-01.3, second half)
**Status:** Not started

Add once v2-1 and v2-3 are both confirmed working — easier to verify
scoping against a known-good baseline than to build both at once.

**Definition of done:** Tenant-scoping Prisma extension verified via
integration test (cross-tenant data leakage impossible even with colliding
IDs).

## v2-6 — Bootstrap/runtime config split + user tenant scoping (REQ-TENANT-01.4, REQ-TENANT-01.5)
**Status:** Not started

Last, since both depend on tenants existing and domain resolution working.

**Definition of done:** `users.tenant_id` enforced; duplicate email allowed
across tenants, blocked within a tenant; bootstrap config trimmed to
`DB_MODE`/DB connection/`ROOT_TENANT_URL`; `app_config` made tenant-aware.

---

All six items together close out `docs/REQ-TENANT-01.md`. All new v2 code
is covered by Vitest (unit/integration via Supertest) per that doc's
testing requirements — Playwright e2e is exercised implicitly once tenants
exist, not tested standalone.

---

## Deferred: CommunityEvents domain, branding and demo

Agreed with Rob 2026-08-09, after the project got its own domain
(`communityeventsproject.com`). Deliberately **future work** — none of it
starts until the tenant items above are landed and stable. Recorded here so
the decisions are not lost between sessions.

Three things that are easy to conflate, kept separate on purpose:

| | What it is |
| --- | --- |
| `www.communityeventsproject.com` | The **root tenant** (`is_root = true`, matches `ROOT_TENANT_URL`). Public landing page explaining the project, and the system-admin tenant — an admin here is the system admin. |
| `demo.communityeventsproject.com` | A **sandbox tenant**. Seeded with generated members, locations, events and a populated leaderboard, with its own colours and logo. |
| `stage.communityeventsproject.com` | **Not a tenant of prod** — a separate deployment (own container, own database). Within that deployment it *is* the root/admin tenant: `ROOT_TENANT_URL` points at it, its tenant row carries `is_root = true`, and an admin there is the system admin of stage. The one Rob develops against until 2.0 goes to prod. **Live as of 2026-08-09**, replacing `communityevents.rtippenhauer.com`. |

### v2-7 — CommunityEvents branding replaces the DinnerBears defaults
**Status:** Not started (deferred)

The per-instance branding already lives in `app_config` and needs no code, but
the *fallbacks* are still DinnerBears: `SITE_SETTING_DEFAULTS` in
`app-config.service.ts`, ~93 hardcoded references across `api/src` (most of
them `dinnerbears.com` in email URLs and fallbacks) and 12 frontend files.

**Definition of done:** a fresh instance with no `app_config` rows presents as
CommunityEvents, and no code path emits a dinnerbears.com URL.

### v2-8 — Root tenant landing page
**Status:** Not started (deferred). Depends on v2-3 and v2-4.

Public marketing page served by the root tenant, explaining the project and
linking to the demo. `frontend/public/landing.html` is the v1-era placeholder
and is the obvious starting point.

**Definition of done:** `www.communityeventsproject.com` and the apex both
serve the landing page and resolve to the same root tenant row.

### v2-9 — Demo tenant
**Status:** Not started (deferred). Depends on v2-3, v2-4 and v2-8.

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

### v2-10 — Operator setup wizard / everything configurable from the site
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

### v2-11 — Operator handbook
**Status:** Not started (deferred).

The written counterpart to v2-10: what an operator needs before and during
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
