# CommunityEvents v2 — Work Item Breakdown

Mirrors `PHASES.md`'s role for v1, scoped to the v2 rewrite (multi-tenant,
Prisma). Items are `v2-<N>`, cut via `/v2-start <N>`, not renumbered
phases — see CLAUDE.md's "V2 Rewrite Status" for why v1 phase numbering
(1–38) doesn't continue here. v1 phase work still uses `/phase-start` etc.
against `PHASES.md` unchanged.

Backlog below is seeded from `docs/REQ-TENANT-01.md`'s required build
order (data layer has to exist before there's anything to scope). Update
each item's status as `/v2-done` closes it; add new items here as later
requirements docs (REQ-TENANT-02, …) land.

## v2-1 — Prisma data layer (REQ-TENANT-01.3, first half)
**Status:** Not started

Install Prisma, model `schema.prisma` against `docs/DATABASE_SCHEMA.md` as
a starting point, wire up `PrismaService` in place of `TypeOrmModule`,
remove TypeORM entities/decorators and `@nestjs/typeorm` once everything
compiles against Prisma. Confirm end-to-end (app boots, existing queries
run) before moving on. Tenant-scoping extension is deliberately **not**
part of this item — see v2-4.

**Definition of done:** TypeORM fully removed; Prisma is the only
data-access layer; app boots and existing queries run against it.

## v2-2 — Tenants table (REQ-TENANT-01.1)
**Status:** Not started

Add the `tenants` table and seed the root tenant, now that Prisma is the
working data layer.

**Definition of done:** `tenants` table exists with root tenant seeded on
first run.

## v2-3 — Domain resolution middleware (REQ-TENANT-01.2)
**Status:** Not started

NestJS middleware resolving `tenant_id` from `Host` header, built against
the now-existing tenants table.

**Definition of done:** Domain resolution middleware correctly resolves
tenant from `Host` header for root domain, `www.` variant, and returns 404
for unrecognized domains.

## v2-4 — Tenant-scoping Prisma Client Extension (REQ-TENANT-01.3, second half)
**Status:** Not started

Add once v2-1 and v2-2 are both confirmed working — easier to verify
scoping against a known-good baseline than to build both at once.

**Definition of done:** Tenant-scoping Prisma extension verified via
integration test (cross-tenant data leakage impossible even with colliding
IDs).

## v2-5 — Bootstrap/runtime config split + user tenant scoping (REQ-TENANT-01.4, REQ-TENANT-01.5)
**Status:** Not started

Last, since both depend on tenants existing and domain resolution working.

**Definition of done:** `users.tenant_id` enforced; duplicate email allowed
across tenants, blocked within a tenant; bootstrap config trimmed to
`DB_MODE`/DB connection/`ROOT_TENANT_URL`; `app_config` made tenant-aware.

---

All five items together close out `docs/REQ-TENANT-01.md`. All new v2 code
is covered by Vitest (unit/integration via Supertest) per that doc's
testing requirements — Playwright e2e is exercised implicitly once tenants
exist, not tested standalone.
