# REQ-CITIES-01 — Cities as a toggleable event filter (tenant-scoped)

**Project:** Community Events
**Area:** Data model / notifications
**Status:** Draft (revised 2026-08-31)
**Depends on:** REQ-TENANT-01. Sequenced before REQ-IMPORT-01 — the import
script needs a settled city model, not one it has to work around.

## Summary

`cities` currently has no `tenant_id` at all. It wasn't overlooked by the
v2-6 scoping pass — it's deliberately in `GLOBAL_MODELS`, seeded from
`cities.json` in `seed.ts`, which runs before any tenant exists. That's
why scoping it isn't just adding a column: it's the same install-order
problem `app_config` and `users` hit in v2-6, solved there by moving that
seeding into `bootstrap.ts` (which creates the tenant first, then seeds
against it). Cities seeding needs the same move, or the sentinel
`tenant_id` gets rejected by the foreign key at install time. This doc's
01.1 below is the non-obvious half of the work, not the column addition.

Separately, `subdomain` is globally unique today, so two tenants would
collide on city names as things stand. `users.cityId` is a required
single-membership FK, and `facebook_group_config` ties Facebook group
posting to individual cities.

Per Rob's direction (2026-08-31, revised from the first draft of this
doc): **Facebook groups are dropped entirely** — first the per-city
relation (2026-08-31), then group ids altogether (2026-09-01). Not worth
the complexity given Meta's API restrictions already limit group posting
to begin with. See 01.5. City filtering becomes a **tenant-level feature toggle**.
When off, cities are irrelevant — events don't require one, no filtering
UI appears anywhere. When on, every event must have a city, and each
member chooses what they want to see: **All**, or a specific set of
cities — the same shape of choice the personal iCal calendar subscription
already offers, extended to event visibility and notifications generally,
not just the calendar feed.

## Requirements

### REQ-CITIES-01.1 — Tenant-scope the cities table

- **Move city seeding out of `seed.ts` and into `bootstrap.ts`** — the
  same fix v2-6 already applied to `app_config` and `users` for the same
  reason: `seed.ts` runs before any tenant exists, so a sentinel
  `tenant_id` on a `cities` row seeded there fails the foreign key.
  `bootstrap.ts` creates the tenant first, then seeds against it; cities
  moves into that sequence rather than staying in `seed.ts`.
- Add `tenant_id` to `cities`, same pattern as every other scoped model.
- **Drop the `subdomain` column** — v1's per-city subdomain routing is
  fully superseded by tenant-level domain resolution.
- Replace the global-unique constraint with `@@unique([tenantId, name])`.
- Tenant admins manage their tenant's city list via the existing
  `/admin/cities` screen, now correctly scoped.

### REQ-CITIES-01.2 — City filtering as a feature toggle

- New feature flag — `feature_cities` on the server (matching the
  existing `feature_ratings`/`feature_leaderboard`/`feature_merch`
  `FeatureKey` names, so `@RequireFeature('feature_cities')` gates the
  city endpoints with no new mechanism), surfaced to the frontend as
  `features.cities` in the `BrandConfigService` payload alongside
  `ratings`, `leaderboard`, `merch`, `members`, `requireMembership`.
  Off by default for new tenants — cities are opt-in, not assumed.
- **Every `city_id` column becomes nullable at the database level**,
  regardless of the flag. Three are `NOT NULL` today and all three need a
  migration: `events.city_id`, `users.city_id` and `locations.city_id`.
  (`announcements.city_id`, `invites.city_id` and
  `facebook_group_config.city_id` are already nullable.) The database
  never enforces the requirement, because flipping the flag in either
  direction must not orphan existing rows or fail a write; **the business
  layer enforces it**, which is the only layer that knows the tenant's
  flag.
- **Off:** no city is required anywhere — events, users and locations all
  write a null `city_id`. No city picker on any form, no city filter UI,
  no city-scoped notification targeting.
- **On:** creating or editing an **event**, a **user** or a **location**
  requires a city, enforced server-side in the DTO/service layer against
  the tenant's flag, not just a UI prompt. Users and locations were the
  gap in the first draft — both carry a required city FK today, and both
  need one when the feature is on.
- **The toggle cannot be turned on until the tenant has at least one
  city.** Enabling it with an empty city list would demand a city on
  every write with nothing to choose from. Refused server-side with a
  message saying to add a city first.

### REQ-CITIES-01.3 — Per-member city preference (multi-select)

- New table `user_city_preferences` (`id`, `tenantId`, `userId`,
  `cityId`), unique on `(userId, cityId)`. **No rows for a user means
  "All"** — the default, matching the current `calendarCityFilter: all`
  behavior for anyone who's never touched the setting. One or more rows
  means "only these cities."
- Replaces the old single-value `calendarCityFilter`
  (`all`/`city`) enum, which can't express "Dayton and Cincinnati but not
  Columbus." That field is deprecated by this table rather than kept
  alongside it — one preference model, not two overlapping ones.
- **`calendarAutoInvite` does not collapse into the same table**, and the
  first draft of this doc was wrong to fold it in. The two enums answer
  different questions and default in opposite directions:
  `calendarCityFilter` defaults to `all`, while `calendarAutoInvite`
  (`none`/`city`/`all`) defaults to **`none`**. "No rows means All"
  expresses *which cities* correctly and *whether to auto-invite at all*
  backwards — every member who never touched the setting would be opted
  into auto-invites they had declined by default. So `calendarAutoInvite`
  narrows to an on/off (`none` and `city` both migrate to their existing
  meaning: off, and on-for-my-cities), and the cities it targets come
  from `user_city_preferences` like everything else.
- **The auto-invite query is the one live call site that targets on
  cities rather than displaying them** — `events.service.ts:811`,
  `OR: [{ calendarAutoInvite: 'all' }, { calendarAutoInvite: 'city',
  cityId: event.cityId }]`. Note it matches `users.cityId`, the single
  membership FK, not any preference. It is rewritten against
  `user_city_preferences`: auto-invite on, and either no preference rows
  or a row matching `event.cityId`.
- UI: a multi-select control — "All cities" or pick specific ones —
  presented wherever the old single-city calendar filter used to live,
  plus wherever else this doc's 01.4 applies it.

**`event_rsvps.fromOtherCity`** — flagged by Claude Code as a field
touched by this doc's scope that none of the four REQ docs decided on.
It's kept, not dropped with the per-city Facebook model — it's an
unrelated tracking field (cross-city attendance, feeding things like the
`city_hopper` achievement), not part of the Facebook group config being
removed. Its meaning is gated by the feature toggle, same as everything
else in this doc:
- **Toggle on:** unchanged from today — tracked, never a gate.
- **Toggle off:** always `false`/unset, not computed, and not shown on
  the attendance-marking form — there's no "other city" when a tenant
  has no cities. REQ-VALIDATE-01 owns that form for its own reasons
  (v2-17); this is the behavior it should build against, not something
  it needs to redecide.

### REQ-CITIES-01.4 — Where the preference applies

Same preference, read consistently everywhere city-relevance matters —
this was the point of Rob's "any calendar" framing, generalizing what the
personal iCal feed already did rather than building a second mechanism:

- **Event list UI** — defaults to the member's preferred cities if any
  are set; "All" is always one tap away, never a dead end.
- **Personal iCal subscription feed** — only includes events from the
  member's preferred cities (or all, if unset) — this is the existing
  behavior the new table generalizes from single-city to multi-city.
- **Announcements/push notifications** — a city-scoped announcement
  reaches members whose preference includes that city, or who have no
  preference set.
- **Still never a gate.** RSVP, rating eligibility, achievement
  eligibility, and moderator permissions never reference city preference
  or `events.cityId` as a restriction — same principle as the first draft
  of this doc, unchanged by the feature-toggle redesign.

### REQ-CITIES-01.5 — Facebook: drop the group model entirely

Not just the per-city relation — **Facebook group ids go away altogether**
(Rob, 2026-09-01). Meta's Graph API already blocks automated group posting
(Groups API publish permissions were deprecated), so the whole structure
was serving a capability that barely worked; keeping a registry of groups
nothing can post to is upkeep for nothing.

- Drop the `facebook_group_config` table, its module
  (`api/src/modules/facebook-groups/`) and its admin surface. Removing the
  model also means **removing it from `TENANT_SCOPED_MODELS`**
  (`tenant-scoped-models.ts:45`) — that list is exhaustive over
  `Prisma.ModelName`, so a stale entry fails the build rather than being
  ignored.
- Drop `invites.facebook_group_id` and its FK/index.
- **The `campaign_facebook` invite *type* stays.** It is not the same
  thing as a group id: it drives `users.inviteSource = facebook_group`
  at `auth.service.ts:199` and `:321`, which is signup attribution and
  still meaningful when the link is shared to Facebook by hand. What it
  loses is the required group selection — `invites.service.ts:39`
  currently rejects a campaign invite without a `facebookGroupId`, and
  that validation goes with the column. The `inviteSource` enum value
  keeps its name and widens in meaning to "came from Facebook," rather
  than being renamed across historical rows.
- **The invite form's group picker becomes a city picker.** A campaign
  invite lets the admin choose the city, defaulting to the tenant's first
  city when the cities feature is on; when it's off, no picker and
  `invites.city_id` stays null. This is what replaces the old implication
  that an invite's group told you its city.

### REQ-CITIES-01.6 — Turning the toggle on for a tenant that already has data

A tenant that ran with cities off has null `city_id` on every event, user
and location it created. Turning the flag on makes a city required, so
those rows have to land somewhere rather than becoming invalid the moment
the flag flips.

- **Backfill on enable:** every existing event, user and location with a
  null `city_id` is assigned the tenant's **first city** — lowest id
  among its active cities, which with the 01.2 guard ("at least one city
  must exist") always resolves. No new `is_default` column: the first
  city the admin created is the default by construction, and an admin who
  wants a different one edits the rows afterward.
- **The backfill is a starting point, not an assignment.** Users and
  locations can change their city freely after the fact through the
  ordinary edit paths — the backfill exists so nothing is left invalid,
  not to decide anything on their behalf.
- Runs as part of the flag write, in one transaction with it, so the
  tenant is never observably "cities on with null city rows."
- **Turning the toggle back off leaves the assigned cities in place.**
  They stop being read and stop being shown; nothing is nulled out, so
  turning it on again lands where it left off rather than re-backfilling
  everything to the first city.

## Impact on REQ-IMPORT-01

- Cities import as tenant-scoped rows into the new tenant, remapped like
  every other table (unchanged from the first draft). **An imported
  tenant has the `feature_cities` flag on**, since its source data is
  city-bearing throughout — the import sets it rather than leaving a
  tenant whose every row names a city the UI won't show. No backfill runs
  (01.6): every imported row already carries a real city.
- Each imported user's old single `cityId` becomes **one row** in their
  new `user_city_preferences` table, not "All" — preserving their
  existing implicit preference rather than silently widening it to see
  everything on import.
- `facebook_group_config` is not imported at all, per 01.5 — the table is
  gone, not just its city relation. Existing `campaign_facebook` invites
  import with their type and their city intact; their old
  `facebook_group_id` is dropped rather than remapped.

## Testing requirements

Per project convention (Vitest + Supertest):

- **Unit (Vitest):** empty-preference-set resolves to "all cities," not
  an error or empty result; feature-flag-off creation of an event, user
  and location each skips city validation entirely; auto-invite off with
  no preference rows resolves to *not invited*, not to "all cities."
- **Integration (Supertest):** two tenants can each have a city named
  identically with no collision; a member with a Dayton-only preference
  doesn't receive a Cincinnati-only announcement or see Cincinnati events
  in their iCal feed, but can still freely RSVP to and rate a Cincinnati
  event; toggling the feature off on a tenant with existing city data
  doesn't break anything already created.
- **Integration, the toggle-on path (01.6):** a tenant with events, users
  and locations created while the flag was off has every null `city_id`
  filled with its first city on enable, and none of those rows is
  otherwise modified; enabling with no cities is refused; a user or
  location can change its backfilled city afterward; toggling off and on
  again does not re-backfill a row whose city was changed in between.
- **Integration, invites (01.5):** a `campaign_facebook` invite is
  created with no group id and is accepted, and a member signing up
  through it still records `inviteSource = facebook_group`; with cities
  on the invite defaults to the tenant's first city and the admin can
  pick another; with cities off it carries no city.
- **Migration:** the three columns dropping `NOT NULL`
  (`events.city_id`, `users.city_id`, `locations.city_id`) leave existing
  rows untouched — verified against a database seeded before the
  migration, not just a fresh one.

## Definition of done

- `cities` is tenant-scoped with no cross-tenant name collisions possible;
  `subdomain` column is gone
- Every `city_id` column is nullable in the database; the requirement is
  enforced in the business layer against the tenant's flag
- City filtering is a tenant feature toggle; off means cities are
  invisible everywhere, on means every event, user and location requires
  one — and the toggle cannot be enabled before a city exists
- Enabling the toggle on a tenant with existing data backfills every null
  `city_id` to that tenant's first city, in the same transaction as the
  flag write, and users and locations can change it afterward
- Members can select "All" or specific cities via
  `user_city_preferences`; the same preference drives event list
  defaults, the iCal feed, and notification targeting consistently
- Nothing uses city preference or `events.cityId` to restrict RSVP,
  rating, achievement, or moderation access
- `facebook_group_config` is gone — table, module, admin screen and
  `invites.facebook_group_id` — while the `campaign_facebook` invite type
  and its `inviteSource` attribution still work, now with a city picker
  in place of the group picker
- REQ-IMPORT-01 imports cities and converts each user's legacy single
  city into one `user_city_preferences` row
- `calendarAutoInvite` survives as an on/off and keeps its `none` default
  through the migration; the cities it targets come from
  `user_city_preferences`, and no member is auto-invited who wasn't before
