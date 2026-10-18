# CommunityEvents v2 — Agent Context (Codex and others)

This file replaced a stale v1 "DinnerBears / TypeORM / Phase 3.5" context on
2026-10-18. **CLAUDE.md is the authoritative project context.** It is long, so
read the sections you need: "V2 Rewrite Status", "Stack", "Database",
"Multi-Tenancy", "Angular Conventions", "NestJS Conventions", "Branching &
Release Workflow". Work items, their order and their definitions of done are
in `V2_PHASES.md`; requirements are in `docs/REQ-*.md`.

## Stack (current main)
Angular 22 standalone components + Angular Material; NestJS; **Prisma 7** on
MySQL (not TypeORM — that was v1); Vitest for API unit and e2e
(`api/vitest.config.mts`, `api/vitest.config.e2e.mts`); Playwright in `e2e/`.

## Rules that are easy to break
- **Never build or push Docker tags.** `:stage`/`:latest` belong to the live
  v1 deployment. `v2-stage` is a single shared slot, published only by Rob via
  `scripts/publish-v2-stage.sh`, and is in use for the DinnerBears cutover.
- **Branches:** `v2-<N>-<slug>` off `main` for a work item. Open a PR and never
  merge it yourself — Rob merges with a real merge commit (never squash).
- **Tenant scoping:** tenant comes from the request host via the Prisma tenant
  extension; never from client input. Owner comes from the session. Don't use
  `runUnscoped` in new code without a stated reason.
- **Prisma migrations:** generate with `prisma migrate dev`. Before a PR is
  merged, rebase on `main` and regenerate your migration if `main` gained one,
  so the folders apply in order.
- **Public repository:** no secrets, no personal content. The coven tenant's
  private material lives in the private BookOfShadows repo.
- **Tests prove isolation:** new tenant-data routes need e2e coverage with two
  users in one tenant plus a user in another tenant.
- AI providers: the journal track uses Gemini (free tier) — see REQ-JOURNAL-01.3;
  only title, topic and public text may be sent to it, never journal content.
