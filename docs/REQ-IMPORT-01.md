# REQ-IMPORT-01 — DinnerBears Import (new tenant)

**Project:** Community Events
**Area:** Data migration / tenant provisioning
**Status:** **Implemented 2026-11-07** (`v2-25`) — superseded in part,
2026-10-03; corrected 2026-10-14; amended on implementation, 2026-11-07.

This doc describes one tenant per source database. DinnerBears is **one tenant
with Cincinnati and Dayton as cities** (Rob, 2026-10-03), so 01.1 and 01.4's
"second run produces a second tenant" is out of date and this doc needs
revising.

## What changed on implementation (2026-11-07)

Six amendments. The first four came from reading v1's code and schema rather
than its docs; the last two came from running it against the live
community, which is the only thing that could have found them.
The implementation is `api/src/import/` with the entry point
`api/src/import-dinnerbears.ts`; `docs/CUTOVER_PLAN.md` has the invocation.

**1. City preferences are the reverse of what 01.3 says, decided by Rob.**
01.3 below says each member's legacy city becomes one `user_city_preferences`
row, "not 'All'", on the grounds that this "preserves their existing implicit
filter". **There is no such filter.** v1's `CityService.currentCity()` resolves
a city from the *hostname*, and on `www.dinnerbears.com` — the host everybody
actually uses, with two active cities — it returns `undefined`, so the home page
requests events with no `cityId` at all. Every member sees both cities today,
and `calendar_city_filter` defaults to `all` as well. One row per member would
*narrow* what all 62 see, on both the event list and the calendar feed, with
nothing shown to explain it.

So the import writes **no rows** (which means every city), except for a member
who set `calendar_city_filter = 'city'` — the only explicit city choice v1
offered — who gets one row for their `city_id`. Everything else in 01.3's
cities bullet stands: `feature_cities` goes on, no backfill runs, and
`calendar_auto_invite` imports as an on/off with `none` staying off.

**2. v1's `feedback` splits across two tables** (Rob, 2026-11-07). v2 put
product reports in the global `system_reports` and community comments in the
scoped `feedback`, and the import follows that split by category: `comment`
stays in `feedback`, `bug` and `feature_request` become `system_reports` rows
attributed to the remapped member and to this tenant. **The split loses things,
named here rather than discovered later:** `system_reports` has no notes table,
no upvotes table, and no `is_private`, `release_note`, `upvote_count` or
`seen_at`. Notes and upvotes on a split ticket are skipped and counted; a
ticket with no title gets one derived from its body, because
`system_reports.title` is NOT NULL where v1's is nullable.

**3. `app_config` imports, and is not listed in 01.3.** It became tenant-scoped
in v2-6, so those rows are what make the imported community look like
DinnerBears rather than a blank tenant — terminology, home copy, the brand
story, invite expiry, inactivity thresholds, guest limits. Safe to import
wholesale: every `app_config` key v1 seeds was checked and none holds a
credential, which matters because these rows are served to unauthenticated
visitors.

**4. Three tables in v1's schema doc do not exist.** `event_guest_rsvps`,
`password_reset_tokens` and `email_verification_tokens` are described in v1's
`docs/DATABASE_SCHEMA.md`, but no v1 migration creates them and no v1 code
reads them — both ORMs carry reset and verification tokens as inline columns on
`users`, which do import. So nothing in v1 lacks a home in v2, and
`invites.guest_rsvp_id` imports as NULL because there was never a row to point
at. The import's preflight asserts their *absence*, so that reading is checked
against the real database rather than taken on trust.

**5. Two bugs the dry run against live data found (2026-11-08).** Both were
invisible to a fixture built from v1's schema, because both need real values
to show themselves.

`events.reservation_confirmed_by` is the *name* of whoever confirmed the
booking, typed in — `VARCHAR(255)` in v1 and `String?` in v2 — and the plan
declared it a foreign key to `users`. The import read "Charles Nottingham" as a
user id, found no match, and wrote NULL. On the live community that silently
blanked 14 of 32 events, each one reported as a routine orphaned key.
`preflight.spec.ts` now holds every `fk` rule against the target field's type,
so a remap of a non-id column fails the build rather than the data.

Separately, a blanked nullable key was counted as a *skipped row*, so
`imported + skipped` exceeded the source row count and validation would have
failed a correct import — 32 events in, 32 written, 14 "skipped". The two are
now counted and reported apart: a skip loses a row, a null loses one field of
one, and only the first closes against the source count.

**6. "Credentials withheld" did not mean "cannot send" (2026-11-08).** Found
on the rehearsal, from an admin screen showing Brevo switched on with no key
behind it. `brevo_enabled` was copied from v1 while `resend_overflow_enabled`
was forced off -- an asymmetry that looked cosmetic and was not.
`BrevoService` resolves `db?.brevoApiKey || env.apiKey`, so a community on a
subdomain of the deployment falls back to the **deployment's** Brevo account.
Imported enabled with no key of its own, such a community could have mailed
every member it had just imported, on the operator's own sending account,
while the run report said credentials were withheld. The dispatcher gates on
the flag, so the import now forces it off alongside the keys. The community
that found it was safe only because `demo.dinnerbears.com` is on its own
domain.

**The definition of done's last bullet is moot**, for the reason the
2026-10-14 correction already gives: there is no second source database. The
connection and target slug are parameters, which is what keeping the script
general is now worth.

**What changed on 2026-10-14: there is only ONE source database.** The
2026-10-03 note said the import was "two source databases into one tenant" and
raised an account-merge question — an address with an account in both. That was
built on the belief that v1 runs Cincinnati and Dayton as separate deployments.
It does not: v1 has one production deployment and one production database,
with both cities as `cities` rows. **So there is no merge, no colliding email,
and no second source.** The import reads one database. (Stage has its own, and
is the dry-run target — a second environment, not a second community.)

Three things this doc still must gain, and none is about merging. The first two
were measured against the live database on 2026-10-14 and are requirements, not
precautions — **26 of 62 members have a calendar feed subscribed and 3 have
push**:

- **Preserve `users.calendar_token`.** A member's iCal subscription is
  `…/calendar/feed.ics?token=…`, already pasted into their calendar app.
  `www.dinnerbears.com` survives as the tenant's host, so the URL keeps working
  if and only if the token still identifies them. Regenerating it stops 26
  calendars refreshing, with no error shown to anyone.
- **Preserve `push_subscriptions` rows**, which is necessary and *not
  sufficient*: a subscription is bound to the `applicationServerKey` it was
  created with, so the production deployment must also inherit v1's
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT`. That is
  deployment env rather than imported data, so it belongs in the cutover
  checklist as well as here — see `docs/CUTOVER_PLAN.md`.
- **Carry `deletedAt` and `hardDeleteAt`.** v1's inactivity sweep leaves
  soft-deleted members in the table. Import them without those timestamps and
  they come back to life as active members; exclude them entirely and their
  RSVP and comment rows lose their foreign-key target.
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

- **Avatars and merch** — imported as tenant-scoped rows per v2-47
  (amended 2026-11-09; both were on the excluded list until then). v1's
  preset avatar rows become the imported community's own picker, and its
  `merch_config` becomes that community's store links. The exclusions
  were written while both tables were global, and both reasons described
  the global table rather than the data: importing the presets "would add
  duplicates visible to every community" and importing the store would
  "point every community at DinnerBears' store". Neither can happen once
  the rows carry a `tenant_id`, and the alternative — restoring the rows
  by hand — is what raised v2-47, because it gives one community its
  picker back by putting its presets in every other community's. The
  static image files are not imported and do not need to be: they ship in
  the frontend image, and `users.profile_photo_path` holds a path string
  rather than a foreign key onto `avatar`, so a member's picture is
  unaffected either way.

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

### Check before import: uploaded images in feedback bodies — **closed, nothing to do**

**Answered 2026-11-07: nothing is lost and no body HTML needs rewriting.** v1's
`main.ts` serves exactly the same five named upload subdirectories v2 does
(`locations`, `achievements`, `custom-icons`, `branding`, `avatars`) and nothing
at the uploads root — and it has no `feedback` or `reports` prefix at all, which
v2 added. v1's `feedback` table also has no `screenshots` column, so a ticket
could only ever have carried an image embedded in its body HTML, and such a URL
was **already broken in v1**. The original note is kept below for the reasoning.



A feedback ticket's body is HTML and may embed `<img src="/api/uploads/...">`.
v2 serves only **named subdirectories** of the upload path and deliberately not
its root, since profile photos sit there behind an auth guard — so a URL
pointing at the flat root 404s here even though the file imports fine.

Check the old repo's `main.ts` for which prefixes v1 served. If v1 served the
root, imported tickets will carry paths v2 will not serve and the images need
moving into a subdirectory with the body HTML rewritten to match. If v1 has the
same subdirectory-only list, those images were already broken there and nothing
is lost.

Found on 2026-10-05, when the same flaw made v2's own feedback and report
attachments upload successfully and render as broken images.

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

- **Uploaded files.** This is a database import: it moves rows and never
  touches the filesystem, and it runs inside a container that need not have
  v1's volume mounted at all. Every `location_photos` row and every
  `profile_photo_path` imports and points at a file that is not there yet, so
  the community looks broken rather than incomplete. Copying v1's uploads tree
  into the deployment's upload mount is a separate cutover step --
  `docs/CUTOVER_PLAN.md` -- and the script's completion message says so.
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
