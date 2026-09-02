# REQ-IMPORT-01 — DinnerBears Import (new tenant)

**Project:** Community Events
**Area:** Data migration / tenant provisioning
**Status:** Draft
**Depends on:** REQ-TENANT-01 (tenant foundation), REQ-CITIES-01 (cities
must be tenant-scoped before they can be imported as tenant data — see
01.3 below). No technical dependency on REQ-CMS-01; it's sequenced after
it per Rob's direction (2026-08-30) only.

## Summary

A one-time, re-runnable import script that reads a complete DinnerBears
(v1) database over an external connection and writes it into a **new**
CommunityEvents tenant — not the root tenant, which remains the platform's
own empty/marketing tenant. Every old auto-increment ID is remapped, since
the target database already has rows from the root tenant, its admin, and
any other tenants created before this runs.

## Background

DinnerBears currently runs as a single-tenant v1 app in its own database.
You have a second DinnerBears-schema database already (the manually
duplicated second user base, in its own container) — the script below is
built generically enough to run against either source, once per source
database, each run producing one new tenant. This doc scopes the first
run (the primary DinnerBears database); the second is the same script run
again later, not separate work.

## Sequencing note

This is sequenced after REQ-CMS-01 per Rob's explicit call, even though it
has no technical dependency on the CMS work — an imported tenant works
identically whether or not blocks/pages/discussion exist yet. Placed last
because it's the highest-consequence one-time operation in the whole
project (real member data, real history) and benefits from running against
the most complete, most-tested version of the schema rather than being
re-verified after every subsequent schema change.

## Requirements

### REQ-IMPORT-01.1 — Connection and tenant creation

- Script accepts a **read-only** connection string to the source
  DinnerBears database as a parameter (not a bootstrap env var — this is a
  deliberate, manually-triggered operation, not part of first-boot).
- Creates a new `tenants` row: `slug` and `domain` provided at invocation
  (not derived from source data, since the old DB has no concept of its
  own tenant identity), `is_root = false`.
- Fails fast, before writing anything, if the target domain/slug already
  exists.

### REQ-IMPORT-01.2 — ID remapping

- Every source table gets an in-memory `Map<oldId, newId>` built as rows
  are inserted (letting the target DB assign new auto-increment IDs, not
  preserving old ones).
- Tables are imported in dependency order (users before RSVPs, events
  before comments, etc.) so a row's foreign keys can always be resolved
  through an already-populated map at the time it's written.
- All FK columns on every imported row are rewritten through the relevant
  map — never copied verbatim from the source ID.

### REQ-IMPORT-01.3 — Full scope

Everything in `FEATURES.md` that has user-generated or historical data,
scoped to the new tenant:

- **Accounts** — users (mapped to the new tenant, role preserved,
  non-validated status preserved), OAuth account links, invite records and
  full lineage (who invited whom, remapped)
- **Events** — events, RSVPs (including guest RSVPs), attendance records,
  event comments, reservation-coordinator assignments
- **Locations** (renamed from Restaurants) — location records, ratings,
  moderator notes
- **Community** — achievements/badges earned, Bear Points ledger entries
  (full ledger, not just current totals — auditability was the point of
  the ledger design), leaderboard is derived, not imported
- **Feedback** — tickets, upvotes, comments, status history
- **Announcements** — posts and comments
- **Content moderation** — existing reports, resolved and open alike —
  it's real moderation history, not just open items (confirmed default,
  not still an open question)
- **Admin/audit** — audit log entries, attributed to remapped user IDs
- **Cities** — imported as tenant-scoped rows per REQ-CITIES-01, not
  excluded, and the import turns the new tenant's `feature_cities` flag
  **on** — its data is city-bearing throughout, so importing with the
  flag off would hide a city on every row. No backfill runs
  (REQ-CITIES-01.6); every imported row already carries a real city.
  Each source user's single legacy city becomes one row in their new
  `user_city_preferences` set, not "All" — this preserves their existing
  implicit filter rather than silently widening it. `calendarAutoInvite`
  imports as-is (it stays an on/off per REQ-CITIES-01.3), so a member who
  had auto-invite off does not acquire it on import.

**Explicitly not imported** (platform-level, not tenant data, or
superseded by the new architecture):
- Email queue/send history, bounce/suppression records (suppression is
  global per REQ-TENANT-01/v2-6's decision, already exists independent of
  any tenant, not reimported)
- `facebook_group_config` in its entirety — the table is dropped per
  REQ-CITIES-01.5, not just its city relation, so there is nothing to
  migrate. `campaign_facebook` invites still import with their type and
  city; their `facebook_group_id` is dropped rather than remapped
- Release notes/changelog — CommunityEvents starts its own

### REQ-IMPORT-01.4 — Re-runnability and safety

- **Dry-run mode**: reports row counts per table and any FK integrity
  issues found in the source data, writes nothing.
- The real run is one transaction per table (not one giant transaction for
  the whole import) so a failure partway through leaves a clear boundary
  of what completed, rather than an all-or-nothing multi-hour transaction.
- Script logs a summary on completion: rows imported per table, any rows
  skipped and why (e.g. an orphaned FK in the source data that couldn't be
  resolved).
- Running the script twice against the same source and a fresh target slug
  produces two independent tenants — this is intentional (it's how the
  second DinnerBears database gets imported later) — but running it twice
  against the **same** target tenant must be refused, not silently
  duplicate data.

### REQ-IMPORT-01.5 — Validation pass

- After import, an automated check confirms: row counts per table match
  source counts (minus anything explicitly excluded per 01.3); a sample of
  FK relationships (RSVP → event → user, achievement → user, points ledger
  entry → user) resolve correctly within the new tenant; no imported row
  references an ID outside the new tenant.

## Testing requirements

Per project convention (Vitest + Supertest):

- **Unit (Vitest):** ID-remapping logic in isolation (given a source row
  and an existing map, produces the correct rewritten FK); dependency-order
  resolution (importing a table before its FK target is available fails
  loudly rather than writing a bad reference).
- **Integration (Supertest/Prisma):** run the script against a small
  fixture source database, assert the resulting tenant's data is fully
  scoped, isolated from other tenants, and passes the 01.5 validation
  checks. Dry-run mode writes nothing to the target — verified by row
  counts before/after.

## Out of scope

- Live/incremental sync — this is a one-time import per source database,
  not ongoing replication. DinnerBears keeps running independently until
  you decide to cut members over manually.
- Automatic detection of which DinnerBears database to import — connection
  details and target slug/domain are always explicit script arguments.

## Definition of done

- Script successfully imports the primary DinnerBears database into a new
  tenant, all FKs correctly remapped, validated by the 01.5 checks
- Dry-run mode reports accurate counts and writes nothing
- Re-running against the same target tenant is refused, not silently
  duplicated
- The same script, given the second (manually duplicated) DinnerBears
  database's connection details, produces a second independent tenant with
  no cross-contamination between the two
