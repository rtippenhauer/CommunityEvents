# Cutover plan — DinnerBears onto CommunityEvents

**Status:** Draft, 2026-10-01. The plan for retiring the single v1 DinnerBears
deployment and running it as one tenant of this one. (This said "the two v1
deployments ... as tenants" until 2026-10-14 — a survivor of the two-deployments
error corrected in CLAUDE.md. v1 is one production deployment, one production
database, two cities, and becomes one tenant; its stage deployment is a second
environment, as v2 has.)

The backlog in `V2_PHASES.md` is sixteen open items. **Five of them stand
between here and a live DinnerBears**, and eleven do not. This document is the
five, why each is required, and what the cutover itself involves — which is
mostly not code.

---

## Why this is now urgent rather than eventual

This repo forked from v1 at Phase 38 / v1.5.1 on **2026-08-08**. Since then v1
has shipped:

| | |
|---|---|
| **Phase 39** — Muse API + Facebook RSVP sync (v1.6.0, 2026-09-29) | four tables, a token system, a bearer guard, a fourteen-rule sync engine, 35 e2e tests, three UI surfaces |
| **Five bugfixes** (v1.6.1 → v1.6.3) | see `v2-33`; all "No DB changes" |

**v1's `docs/PORT_TO_COMMUNITYEVENTS.md` is the authoritative list and this
document deliberately no longer restates it.** It did, and that is exactly what
rotted: the table above read "three bugfixes (v1.6.1)" until 2026-10-14, by
which point v1 was at **v1.6.3** and two more fixes existed that nothing in this
repo mentioned. A duplicated list goes stale silently every time a v1 bugfix
lands, while a version number goes stale *visibly*.

So the check is a version comparison, not a reading: **this document was last
reconciled against v1 v1.6.3.** If v1's `package.json` is ahead of that, the
delta is in its port doc and has not been recorded here yet.

**The port list was growing faster than it was shrinking.** Two decisions on
2026-10-01 stop that:

- **v1 takes no new phases.** Phase 40 (Ban Records) moved here as `v2-30`
  before any v1 code existed, so it cost nothing. Bugfixes may still land in
  v1 — all three in 1.6.1 are "No DB changes" and a paragraph each — but a
  phase is weeks of porting.
- **The *phase* list is closed.** Phase 39 is the last one to port, and nothing
  further will be added. This was previously written as "the drift list is final
  at four entries", which contradicted the line directly above it — bugfixes
  were always allowed to keep landing, so the list necessarily grows. What is
  frozen is the expensive half: a phase is weeks of porting, a bugfix is a
  paragraph.

That is what makes a cutover plan possible at all. Without the freeze there is
no fixed target to aim at.

---

## What "lift and shift" requires, measured (2026-10-14)

Rob's framing: **import as much as possible**. That is a sharper test than
"does DinnerBears have it today?", because it asks whether v2 has somewhere to
*put* every row v1 holds — a question with a checkable answer.

Comparing v1's 41 entities against v2's 45 Prisma models, **exactly four tables
exist in v1 with no home in v2**:

| v1 table | Comes with |
|---|---|
| `api_tokens` | `v2-29` (Phase 39 — Muse bearer tokens) |
| `event_facebook_links` | `v2-29` |
| `facebook_accounts` | `v2-29` ("a Facebook profile seen on a synced Going list") |
| `facebook_event_attendees` | `v2-29` |

**All four are Phase 39.** Nothing else in v1 lacks a destination, so the
schema answer to "can we lift and shift" is: yes, once `v2-29` lands. The eight
models v2 has and v1 does not (`tenants`, the demo tables, `system_reports`,
`tenant_secrets`, `oauth_handoffs`, `email_log_views`, `release_feedback`,
`demo_requests`) are all v2-native with nothing to import.

So the pre-migration list is **three items, one of which is not a port**:

1. **`v2-33`** — v1's five bugfixes.
2. **`v2-29`** — Phase 39. Closes the entire table gap above.
3. **`v2-24`** — cities. **The non-port item**, and the one easy to forget: v1's
   `cities` holds both rows with a globally-unique `subdomain`, v2's `cities` is
   not tenant-scoped at all, and the import writes `user_city_preferences`,
   which this item creates. It also closes a live cross-tenant write hole.

Then `v2-25` (the import) and the production deployment. The dispatcher claim
is done and awaiting merge.

### Two decisions from Rob, 2026-10-14

**New members default to Cincinnati, and change it in Profile.** This is what
happens today — most members defaulted there — so it is explicitly *not* new
work: `resolveCityId` already falls back to the first city by name, and the
Profile → Settings picker already exists. It removes the "deliberate mechanism"
wording from `v2-24`'s definition of done rather than adding to it.

**Preserve `users.calendar_token` and `push_subscriptions.endpoint`.** Measured
against the live `dinnerbears` database on 2026-10-14:

| | |
|---|---|
| Members (not deleted) | **62** |
| With a calendar feed subscribed | **26** |
| With a push subscription | **3** |

**26 of 62 is 42% of the community, so this is a requirement rather than a
nice-to-have.** `calendar_token` is one column on `users`; carry it with the
rest of the row and every one of those feeds keeps working, because
`www.dinnerbears.com` survives as the tenant's host and the feed URL is
unchanged. Regenerate it and 26 calendars stop refreshing with no error shown
to anyone.

The 62 is worth knowing on its own: this is a small community. The import is
small and fast, a dry run is cheap to repeat, and contacting affected members
individually is realistic if anything does go wrong.

**Push needs something the import cannot do by itself**, and it is **settled**:
production adopts v1's VAPID keypair. A subscription is bound to the
`applicationServerKey` it was created with, so fresh keys would invalidate all
three regardless of whether their rows import. One keypair serves every tenant
by design, and production holds no subscriptions yet, so adopting v1's breaks
nothing. Details and the exact variables are in the production-deployment
section above.

### Release notes are one shared list, so they are not tenant data

Rob, 2026-10-14: "we only have 1 list of release notes." Correct, and it
changes where the import of them belongs. `releases` is a **global** table in
v2 — one list per deployment, shared by every community, which is exactly why
notes are written with `{{events}}` and `{{points}}` tokens that render per
community.

So importing v1's `releases` rows is a **one-time deployment setup step, not
part of the per-tenant import**. Putting it inside the tenant import would
re-import DinnerBears' release history every time a future customer is
onboarded.

Done that way it is also strictly better than copying the markdown files, and
fixes a defect for free: v1's rows carry their **real `published_at` dates**,
where the file importer stamps `NOW()` on first insert and would give four
backfilled notes the same whole second — the tie recorded against `v2-33`. The
file importer then keeps working as designed, since its `ON DUPLICATE KEY
UPDATE` deliberately refreshes only title and body and leaves `published_at`
alone. `v2-33`'s `{{events}}` substitution is still needed for them to render.

---

## The test for "is this a blocker"

**Does DinnerBears have it today?** If not, going live without it is parity,
not regression, and it belongs after the cutover. That single question moves
eleven of the sixteen open items off the critical path, including the entire
CMS batch, the operator wizard and handbook, and ban records.

It also promotes two things that were not on the backlog as blockers at all:
the email dispatcher's missing claim step, and production deployment.

---

## The fastest route to one codebase (2026-10-14)

Rob's goal, stated plainly: stop maintaining two codebases, as soon as
possible. The ordered list below is what must be *true* at cutover. This
section is what to do about it in which order, which is not the same thing —
the list reads as serial and three parts of it are not.

**Four changes to the obvious order, in descending value:**

**1. Stand up the production deployment early, in parallel with the code
work.** It is step 7 below, which implies last, and it is the step with all the
unknown unknowns: no prod image tag, no prod Unraid template, no prod database,
no `SECRET_ENCRYPTION_KEY` on a mapped volume, and Cloudflare certificate
behaviour that already cost an afternoon on stage during `v2-13`/`v2-14` (the
Universal SSL wildcard covers one label, so a `demo.stage.…` host has no edge
certificate). None of that depends on a single line of `v2-33`, `v2-29`,
`v2-24` or `v2-25`. Doing it while code is in flight converts the riskiest step
from a schedule tail-risk into something already proven — and a prod deployment
with no data is also where the import dry runs should land.

**2. ~~Answer the email-collision question now.~~ WITHDRAWN 2026-10-14 — there
is no collision.** This was listed as the single question most likely to stall
the end of the project: with two source databases, an address holding an account
in both would be two rows that could not coexist under
`@@unique([tenantId, email])`, and a merge rule would be needed for password
hashes, roles, points ledgers and the rest.

There is **one** source database. Email is already unique inside it, nothing
merges, and the whole problem was an artefact of this document's own wrong
premise about how v1 runs. Recorded as withdrawn rather than deleted, because
the reasoning was sound and only the fact underneath it was false — and because
a planning document that quietly loses its scariest item teaches nobody anything.

**What to do with the time instead: rehearse the import against
`stage.dinnerbears.com`'s database.** v1 has a stage deployment, which is a
realistic source schema that nobody minds breaking — a far better dry-run
target than a copy of production, and available now rather than at the end.

**3. `v2-33` before `v2-29`.** Both are ports and neither depends on the other,
but `v2-33` is five paragraph-sized fixes with no schema changes against
`v2-29`'s four tables, token system and fourteen-rule sync engine. It also
unblocks the release-note import below, and it is the kind of work that reveals
how far v2 has drifted from v1 before that question is asked on something large.

**4. Treat the release notes as part of those two items, not as a task.** See
the section below; the files cannot land before the features they describe.

**What genuinely must stay serial:** `v2-24` (cities) before `v2-25` (the
import), because the import switches `feature_cities` on and writes
`user_city_preferences`, which are v2-24 deliverables. And the dispatcher claim
before any of it, which is already done and only wants merging.

---

## The rehearsal sequence (Rob, 2026-10-14)

Stage exists → set up `stage.dinnerbears.com` with a member who has a calendar
feed → migrate → test → test-migrate live `www.dinnerbears.com` data → change
the URL and strip the email credentials → validate → build production →
migrate, smoke test, go live.

**Creating a calendar subscriber before migrating is the sharp part.** It turns
"did `calendar_token` survive" from a hope into an observation, and 26 of 62
members depend on it.

### The step that needs care: "can't email production members"

The intent, in Rob's words: live DinnerBears data running on stage, under a
stage URL, must not be able to email real members. **Its two halves pull in
opposite directions, so the order matters.**

`BrevoService.getEffectiveConfig` resolves a key as
`db?.brevoApiKey || env.apiKey`, where `env` is populated **only if**
`isOnDeploymentDomain(tenantId)` is true — that is, the tenant's domain is the
deployment's or sits under it. So:

- **A tenant on a `dinnerbears.com` host cannot send**, full stop, once its own
  key is cleared. Not on the deployment's domain, so `env` is empty strings and
  there is nothing to fall back to. The guard is a property of the domain.
- **A tenant moved to a `*.stage.communityeventsproject.com` host *gains* the
  ability to send**, because it now sits under the deployment domain and
  inherits stage's env `BREVO_API_KEY`. **Clearing the tenant's own key does not
  help**, because the fallback is what supplies the credential.

So changing the URL to a stage address is the step that *creates* the hazard,
and clearing the tenant's own key does not close it.

**Decided by Rob, 2026-10-14: disable email across the whole stage deployment.**
"It's just a test bed." That is the blunt option and it is the right one here —
it does not depend on which host the rehearsal tenant ends up on, which is the
detail most likely to drift mid-rehearsal.

**Unset both provider keys in stage's env, not just Brevo.** The env fallback
has two copies on the sending path and `BREVO_API_KEY` is only one of them:

- `BREVO_API_KEY` — `BrevoService.getEffectiveConfig`
- `RESEND_API_KEY` — `ResendService`, which carries its own identically-gated
  `|| env` line

Resend is the overflow provider and `resend_overflow_enabled` defaults to
`false`, so it is normally dormant. **The import is what makes that worth
checking:** v1 has its own `email_provider_config`, so a copied row can arrive
with overflow switched **on**, and a dormant provider becomes a live one without
anybody enabling it. Either unset `RESEND_API_KEY` too, or confirm
`resend_overflow_enabled = 0` on the imported row.

(`BrevoWebhookService.register` holds a third copy of the same fallback. It
registers callbacks rather than sending, so it cannot mail a member, but it is
the third place to look if this reasoning is ever revisited.)

**What this costs:** stage cannot test email while the keys are out, which
matters for any later item whose stage pass needs real sends — `v2-9`'s needed
real sends and live inbound webhooks. It is a toggle, not a permanent state:
out while live member data is sitting on stage, back in afterwards.

**Verify rather than assume:** on the imported tenant, Admin → Email should
report no provider available. Queued mail then settles as `BLOCKED` rather than
sending, which is the guard working and not a fault.

---

## The v1 release notes (Rob's ask, 2026-10-14)

**Goal:** members arriving on v2 see the release history they already know,
through `1.6.4` or wherever v1 has got to at cutover.

**It is a four-file copy, and it is not a task of its own.** v2's
`api/release-notes/` holds `1.5.0.md` and `1.5.1.md` — the fork point. v1 holds
those plus `1.6.0`, `1.6.1`, `1.6.2` and `1.6.3`. The files are plain markdown,
`# Title` then body, with no metadata to translate.

**Why it is not a copy you can do today**, and this is the importer's own
design rather than an obstacle to route around. `ReleaseNotesImporterService`
runs on every boot, imports every `.md` in the directory, and **finalized
entries always import as published**. The notes ship inside the image
specifically so that "a note only ever appears once THIS instance is actually
running the code it describes" — its comment says so. Copying `1.6.0.md` now
publishes a note announcing Facebook RSVP sync on a deployment that has no
Muse API.

So each note travels with its feature:

| Note | Lands with | Describes |
|---|---|---|
| `1.6.0.md` | `v2-29` | Phase 39 — Facebook RSVP sync |
| `1.6.1.md` | `v2-33` | three of the five fixes |
| `1.6.2.md` | `v2-33` | the Gmail calendar-reply fix (#45) |
| `1.6.3.md` | `v2-33` | the reservation self-confirm fix (#47) |
| `1.6.4+` | whatever ports it | unknown until cutover |

**Two things block a clean import, both found while checking this:**

**`{{events}}` renders literally.** v1's notes are written with `{{points}}`,
`{{locations}}` and `{{events}}` so one note reads correctly on every instance —
`1.6.0.md` uses `{{events}}` four times in its first paragraph. Substituting
them is fix **#43**, which v2 does not have: only `updates.component.ts` touches
the tokens, so the login splash prints them raw. **The release-note import
therefore depends on `v2-33`**, not merely on the features being present.

**The splash can show the wrong release as newest.** `whats-new.service.ts`
picks the latest with `orderBy: { publishedAt: 'desc' }` and **no `id`
tiebreaker**, `releases.published_at` is `DATETIME(0)` (whole seconds), and the
importer inserts every file in one sequential loop with `VALUES (…, NOW(), …)`.
One note at a time, as every release so far has been, never ties. Four notes
imported on one boot all land in the same second, and which one the splash
calls newest is then whatever the engine returns — plausibly `1.6.1` instead of
`1.6.3`. This is the identical defect `v2-31` fixed in the email log, where
`created_at` is also `DATETIME(0)` and ties made pagination skip and repeat
rows; the fix there was an `id` tiebreaker in `orderBy`, and it is the same fix
here. Recorded as part of `v2-33`. The announcements query two lines below has
the same shape and is less exposed, since announcements are written by hand one
at a time — fix both.

**One mercy:** the splash shows only the single latest unseen release, never a
backlog, so importing four notes produces at most one popup rather than four.
`fs.readdir` order is also worth a `.sort()` while in there — it is relied on
and unsorted, and alphabetically `1.6.10.md` precedes `1.6.2.md`.

### What members actually read at go-live: one `2.0` note

**Decided by Rob, 2026-10-14.** Everything v2 has accumulated is consolidated
into a **single 2.0 release note** for production, covering **user-focused
changes only**, and kept tight.

That also settles the version question: v1's notes import with their real dates
(`1.5.0` … `1.6.3`), and `2.0` follows them. Numbering continues v1's lineage
rather than restarting, so a member's Updates page reads as one unbroken
history of the thing they have been using.

**The raw material is `docs/NEXT_RELEASE_V2.md` — 834 lines across 28
sections** — and the filter does most of the work, because the great majority
of it is operator-facing: the data layer, multi-community groundwork, data
separation, stored credentials, per-community API keys, operator screens,
"behind the scenes". A DinnerBears member is not the audience for any of it.

**Expect the result to be genuinely short, and treat that as correct rather
than as a gap.** The cutover is a lift and shift: for a member, almost nothing
about using the site changes, which is the *point*. The honest member-facing
list is roughly calendar entries, feedback screenshots, reports reaching the
people who build the site, and whatever `v2-33` restores. Padding it with
architecture would be writing release notes for the wrong reader — and the
operator-facing material is already documented, which is a different job from
being announced.

`docs/NEXT_RELEASE_V2.md` therefore stays what it is: an accumulating record to
draw from, not the note itself. The note is `api/release-notes/2.0.md`, written
once, imported by `ReleaseNotesImporterService` like any other.

---

## The critical path

### 1. `/v2-done 14`

Housekeeping. Nothing depends on v2-14 (demo communities); it is complete on
its branch and waiting only on a stage sign-off.

### 2. Dispatcher claim step — `bugfix-dispatcher-claim`

Carved out of `v2-27`, whose own section already says this half is worth doing
alone and first.

`EmailDispatcherService` selects rows `WHERE status = PENDING`, sends, then
writes SENT. **Nothing marks a row in flight.** That is safe only while exactly
one dispatcher runs, and that is already false: Admin → Send Now calls
`dispatchPending` from a request, so pressing it during a cron run can send the
same message twice.

Latent today because stage has little mail and one operator. A go-live blocker
because DinnerBears has real members receiving real mail, and the failure is
duplicate delivery to them.

The fix is an atomic claim — `updateMany` from PENDING to a SENDING state
conditional on the row still being PENDING, then send only what was claimed.
Hours, not days.

### 3. `v2-29` — port v1's Phase 39

The largest item on this path, and the one that cannot be skipped: cutting over
without it switches off the Facebook mirror DinnerBears now runs on.

The spec is v1's `docs/PORT_TO_COMMUNITYEVENTS.md`. Code is re-implemented, not
copied — this repo is Prisma and tenant-scoped. Full notes in that item's
`V2_PHASES.md` section; the two decisions that must be made before the schema
is written are **how the token resolves its tenant** (from its own row, never
the Host header) and **the automation-account conflict** (v2 allows exactly one
non-human account per tenant; Muse is a second).

### 4. `v2-24` — cities, tenant-scoped

Cannot be reduced to a schema-only slice. `REQ-IMPORT-01.3` has the import
switch the new tenant's `feature_cities` flag **on** and write each source
member's single legacy city into a `user_city_preferences` row — both of which
are v2-24 deliverables, not just the `tenant_id` column.

Closes, as a side effect, the live cross-tenant hole recorded in that item:
`CitiesAdminController` is `@Roles(ADMIN)` over a global untenanted table, and
since `v2-14` shipped demo communities, **every demo visitor is an `admin`** and
can therefore list, rename or deactivate any community's cities. That stopped
being theoretical the day demos went live.

> If the cutover slips, apply v2-24's own stopgap in the meantime: restrict the
> controller to the root tenant. It costs almost nothing.

### 5. `v2-25` — the import

The deliverable. One-time, re-runnable, reading the v1 database over an external
read-only connection into a **new** tenant — never root, which stays this
platform's own community.

Run dry-run first, against a copy, and read the validation counts before
anything touches a real target.

Note this **reverses a prior decision** deliberately: v2-25 was sequenced last
on 2026-08-30 because it is the highest-consequence one-time operation in the
project and benefits from the most complete schema. That reasoning was sound and
assumed go-live was distant. It is not any more.

### 6. Production deployment

**Confirmed shape (Rob, 2026-10-14):** two deployments, each with **its own
database**. Stage exists today. Production is created at go-live, mirroring what
`www.dinnerbears.com` is for v1, and **in the long term hosts every production
community** — each one a tenant of that single deployment, which is the whole
point of the rewrite.

Two consequences worth stating, because both are already covered elsewhere in
this document and are easy to lose:

- **Production's root tenant is the operator's own**, serving the marketing
  landing page (`v2-13`). DinnerBears is a **non-root** tenant on its own
  domain, so by `v2-12`'s rule it may not inherit the deployment's Brevo or
  Google credentials and must bring its own — see "Email credentials" and
  "OAuth" below.
- **The rehearsal belongs on stage and the real import on production.** Separate
  deployments and separate databases mean no contest over `tenants.domain`,
  which is unique: a rehearsal tenant claiming `dinnerbears.com` on stage does
  not block the real one claiming it on production, and the rehearsal can stay
  up as a reference afterwards.

> **The domain is `communityeventsproject.com`** — confirmed by Rob
> 2026-10-14, so production is `www.communityeventsproject.com` and stage is
> `stage.communityeventsproject.com`, exactly as `REQ-TENANT-01.7` and CLAUDE.md
> already say. Noted because the near-miss is easy to make in both directions:
> the **GitHub repository** is `rtippenhauer/CommunityEvents`, with no
> "project", and `communityevents.com` is somebody else's domain. The repo name
> and the domain are deliberately not the same string; neither is a typo for the
> other.

It does not exist in any form yet:

- **No v2 production image tag.** `scripts/publish-v2-stage.sh` is the only
  publish script here, and `:stage` / `:latest` belong to v1's pipeline and must
  not be touched. A new tag is created at the cutover, not before.
- **No production Unraid template.** `docker/` carries
  `communityevents-v2-stage-unraid.xml` and the old `dinnerbears-unraid.xml`.
- **No production database.**
- **No `SECRET_ENCRYPTION_KEY` on a mapped production volume.** See
  `docs/SECRETS.md`. Getting this wrong is how v2-7's stage deploy produced
  three keys in three container recreates. Map `/app/appdata` before first boot,
  and back the key up the moment it is generated.
- **No VAPID keypair — and it must be v1's, not a fresh one** (decided by Rob,
  2026-10-14). Copy `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` from v1's
  environment into production's, **before anybody subscribes to push on the new
  deployment**.

  One keypair serves every tenant, by design and not by omission:
  `PushService.onModuleInit` reads the three values from env once at boot and
  hands them to `webpush.setVapidDetails` globally, and VAPID appears in neither
  `tenant-secret-keys.ts` nor `encrypted-columns.ts`, so there is no
  per-community override to configure. `env-classification.ts` says why it must
  stay that way: "a per-tenant value would invalidate those subscriptions with
  nothing able to re-establish them."

  Carrying v1's keys costs nothing here because **production has no
  subscriptions of its own yet**, so there is nothing to invalidate by adopting
  them — while minting fresh ones silently kills the 3 that exist in
  DinnerBears.

  **Only the keys have to match.** `VAPID_SUBJECT` is a contact address in the
  JWT, not part of what binds a subscription, so it is free to become a
  CommunityEvents address. The public and private halves must be byte-identical
  to v1's.

  **Omitting them fails quietly**: with any of the three unset, `PushService`
  logs "VAPID keys not configured — push notifications disabled" and carries
  on. Nothing errors, no screen says anything, push simply never works.

---

## The cutover itself

Code being ready is not the same as being live. These are the steps that happen
on the day, and most have bitten this project before in some form.

### Tenancy shape

**DinnerBears is one tenant. Cincinnati and Dayton are cities inside it**
(Rob, 2026-10-03).

**As of 2026-10-14 this is a description of v1, not a decision about v2.**
v1 has **one production** deployment and **one production** database — plus
stage, the same second environment v2 has — and Cincinnati and Dayton are
`cities` rows inside it, seeded together by v1's third migration. There was
never anything to reverse and never two source databases.

The correction matters because this section's original reasoning was confident
and wrong in both halves: it said "v1 runs two deployments because v1 had no
other way to run two cities". v1 runs one production deployment, and has had a
`cities` table since 2024. The duplication behind v2's premise was a **second
deployment being developed for a different group**, which never reached
production (Rob, 2026-10-15) — the effort that led to CommunityEvents in the
first place, and which holds no data to import. "Two deployments" got mapped
onto the two city names, and this plan then reasoned for a fortnight about
merging source databases that do not exist.

A tenant is a community; DinnerBears is one community that meets in two cities,
and v1 already modelled it that way.

Rob's Phase 40 direction already said this before this section was corrected —
**a ban is community-wide**, which is only a coherent sentence if the community
spans both cities. Under two tenants somebody barred in Cincinnati would simply
sign up in Dayton.

`REQ-CITIES-01` is what makes this work and already assumes it: `feature_cities`
on, every event, user and location carrying a city, and each member choosing
which cities they want to see. That is the feature the two-tenant shape would
have left switched off and unused on the one deployment that needs it most.

**What this merges, deliberately:** one Brevo account, one Google app, one
`mail_domain`, one `app_config`, one set of admins, one member directory, one
leaderboard. All of those were listed as reasons to stay split, and all of them
are things one organisation should have one of.

**The one genuinely hard consequence is duplicate people.** Email is unique per
tenant (`@@unique([tenantId, email])`), so an address holding an account in both
v1 databases is two rows that must become one row or collide at import. Two
tenants made this a non-question by keeping them apart. It needs an explicit
answer in `REQ-IMPORT-01` before the import runs:

- which account wins where the two disagree (role, join date, notification
  prefs, city);
- what happens to the loser's RSVPs, points, achievements and ratings —
  reassigned to the survivor, or dropped;
- what the survivor's city preference becomes, since the whole point is that
  this person attends in both.

Until that is decided, the import is **not** a matter of pointing the existing
script at a second database. See `REQ-IMPORT-01`, which still describes the
two-tenant shape and needs revising to match this section.

### Domains — one host, and retiring the city subdomains

**Decided by Rob, 2026-10-14: one tenant, one host.
`cincinnati.dinnerbears.com` and `dayton.dinnerbears.com` are dropped.** This
is the natural consequence of "DinnerBears is one community meeting in two
cities" — a city is a row, so it does not get a hostname — but it had not been
written down, and it is the half of the decision with migration consequences.

Rob's reason for being comfortable dropping them: **nobody uses them.** What is
wanted instead is filtering events by city with no URL involved, which is what
`v2-24` already specifies — and members already select their own city at
Profile → Settings, and All-vs-my-city at Profile → Calendar, so none of that
capability is at risk.

What the subdomains were actually supplying was the *registration default*, and
with one host it becomes `cities[0]` — Cincinnati, ordered by name. That
matters less than it first appears: a new member's view defaults to all cities
and their auto-invites default to off, so nothing they see is wrong until they
opt into a city-filtered view, which names the city in its own label. It is a
defaulting choice to make deliberately in `v2-24`, not a hole. Imported members
keep their real city either way.

`tenants.domain` is stored bare and **cannot hold a `www.` prefix** —
`normalizeTenantDomain` strips it, so `www.dinnerbears.com` and
`dinnerbears.com` resolve to one tenant row by design. Check the apex actually
has an A record before relying on it; in v1 the apex published MX only, which is
the whole reason `BASE_DOMAIN` was `www.dinnerbears.com` there.

**Most of the risk here evaporated on 2026-10-14**, and what is left is worth
keeping. v1's real hosts are `www.dinnerbears.com` (live) and
`stage.dinnerbears.com` (testing). The city subdomains are a `cities.subdomain`
column and a pair of names nobody uses — Rob's words — so dropping them breaks
nothing members hold. **And `www.dinnerbears.com` survives as the tenant's
host**, which means the feeds, push subscriptions, sent-email links and OAuth
redirect URIs below all keep pointing at a host that still answers.

So the table is no longer a cutover hazard list. It stays because it is the
reasoning that applies to *any* host this project ever retires — a customer
leaving, a community renaming itself — and because one item in it survives
regardless of hostnames: see the `calendar_token` note underneath, which is
about the *token*, not the host.

**Retiring a host is not deleting its DNS record.** Four things members hold are
bound to a hostname, and only one of them fails in a way anybody notices:

| What | If the host just disappears |
|---|---|
| **iCal feed subscriptions** | **Silent.** `feedUrl` builds `https://<tenant host>/api/v1/calendar/feed.ics?token=…` and the member pasted that into Google or Apple Calendar months ago. A dead host makes the client stop refreshing; it does not tell anybody. The member simply stops seeing dinners and assumes none are scheduled. |
| **Web push subscriptions** | **Silent.** A push endpoint belongs to the service-worker registration, which is per *origin*. A member who installed the PWA from `dayton.dinnerbears.com` has a subscription that cannot be moved to another host at all — `push_subscriptions.endpoint` is unique and origin-bound, so it has to be re-created by that member visiting the new host. |
| **Links in already-sent email** | Semi-visible. Invite, event and reset links in mail already delivered point at the old host and cannot be rewritten. They fail as a dead link rather than a wrong page. |
| **OAuth redirect URIs** | **Loudly**, which makes it the good case: Google answers `redirect_uri_mismatch`. Register the surviving host and drop the others as part of the cutover. |

A retired host that anybody did use should therefore keep answering **301
redirects for a long window** rather than being removed. Not needed for the city
subdomains, since nobody used them.

**The one item that survives the good news: `users.calendar_token` must be
preserved by the import.** This is about the token, not the host. A member's
feed URL is `https://www.dinnerbears.com/api/v1/calendar/feed.ics?token=…`,
already pasted into Google or Apple Calendar; the host is unchanged, so the URL
keeps resolving — **as long as the token behind it still identifies that
member**. `users.calendar_token` is a unique `VARCHAR(36)` and
`REQ-IMPORT-01` does not mention it anywhere. Carry it across and every
subscription survives the cutover silently and correctly. Mint fresh tokens and
**every calendar feed in the community dies at once**, with no error shown to
anyone, and the only remedy is asking every member to re-subscribe. It should be
an explicit import requirement, and it is cheap to make one.

The same applies to `push_subscriptions.endpoint`: same origin, so the
registrations stay valid if their rows are imported.

### Mail domain — set it explicitly, never derive it

`mail_domain` is a per-tenant `app_config` row and **must not be derived from
the tenant's host**. A tenant subdomain normally publishes no MX record, so
`hello@dayton.dinnerbears.com` would bounce silently. v1's Phase 38 was partly
a fix for exactly this. Set each tenant's mail domain as part of creating it.

### Inbound mail — calendar replies (Cloudflare)

**This exists in no repo and is the least documented thing on the critical
path** (written down 2026-10-15, after a stage invite's reply address was
questioned). v1 works because of Cloudflare dashboard state, not because of
anything checked in — the same class of divergence as v1's PR #46, where the
Worker's live `API_URL` had been corrected in the dashboard while the repo copy
still said the apex.

**Which address a reply goes to.** Two functions resolve an `ORGANIZER`, and
they are not interchangeable:

| Path | Function | Address |
|---|---|---|
| The emailed invite (`buildInviteAttachment`) **and** the subscribed iCal feed | `AppConfigService.calendarOrganizerEmail()` | `calendar@` / `calendar-stage@<mail domain>` |
| "Add to calendar" download and guest links (`generateIcs`, `generateGuestIcs`) | `AppConfigService.eventOrganizerEmail()` | `noreply@<mail domain>` |

A reply follows the `.ics` `ORGANIZER`, **not** the message's `From` — the From
is the Brevo sending identity (`noreply@`, correctly). So the emailed invite is
repliable and always was; the `noreply@` on a download is deliberate, because
nothing is expecting a reply to a file.

The local part is `calendar-stage@` when `APP_URL` contains `stage`, and the
domain is that community's own: `contact_calendar_email`, else a derivation
from its `mail_domain`, else `CALENDAR_ORGANIZER_EMAIL`, else the deployment
domain. **Verify it by reading one real invite's `ORGANIZER` line** rather than
deducing it — the resolution order has four steps and only the row knows.

**What Cloudflare needs**, per zone:

1. **Email Routing enabled on the apex.** It is a zone-level feature that
   applies to the apex by default. Subdomains can be added (up to 30 domains
   per zone, apex included) but take **literal** rules only — **catch-all is
   apex-only**. This is why the stage reply address is
   `calendar-stage@communityeventsproject.com` and not
   `calendar@stage.communityeventsproject.com`: the second needs the subdomain
   onboarded, and buys nothing.
2. **A route per address → the email Worker.** The Worker does not filter: it
   forwards whatever is routed to it. So the route list *is* the access
   control.
3. **Worker variables.** `CLOUDFLARE_EMAIL_SECRET` matching the API container,
   `API_URL` and `STAGE_API_URL` on real web hosts. **The repo's default is
   still the apex** (`https://dinnerbears.com`), which has MX and no A record,
   so an unset variable fails silently — Cloudflare logs the message as
   **Handled** either way.

**The prefix decides the deployment, which is the trap.** The Worker branches
`to.startsWith('calendar-stage@') ? STAGE_API_URL : API_URL`. Every other
address — `calendar@`, `noreply@`, anything new — posts to `API_URL`,
production. An address invented for stage that does not start with
`calendar-stage@` silently delivers stage replies to production.

**At go-live:** `calendar@dinnerbears.com` already routes to the Worker and
posts to v1's host. Moving `API_URL` to the new deployment is a dashboard edit
with no deploy, so it is also reversible in seconds — which makes it a good
rollback lever and a bad thing to forget.

**Still unverified:** whether a reply that arrives and is refused is visible to
anyone. It is a container log line and nothing else; `v2-34` is the admin-visible
record, and until it exists a stage test means watching `docker logs -f`.

#### What Cloudflare actually holds (audited and configured 2026-10-15)

Read from the API, not remembered. One account; the zones that matter are
`communityeventsproject.com`, `dinnerbears.com` and `tippenhauerworks.com`.
**If the dashboard and this section disagree, the dashboard is the truth and
this section is the bug** — re-audit and correct it here.

**Two email Workers, deliberately.** v1's `dinnerbear_calendar` serves both
`calendar@dinnerbears.com` (→ `API_URL=https://www.dinnerbears.com`) and
`calendar-stage@dinnerbears.com` (→ `STAGE_API_URL=https://stage.dinnerbears.com`).
v2 could not share it: pointing its `STAGE_API_URL` at v2's stage would have
sent v1 stage's RSVPs there. So v2 has its own, `communityevents_calendar`,
deployed from [`cloudflare/email-worker.js`](../cloudflare/email-worker.js) —
which differs from v1's copy in one way: **no hardcoded fallback host.** An
address whose deployment has no URL is dropped with a log line.

| Worker | Variable | Value |
|---|---|---|
| `communityevents_calendar` | `STAGE_API_URL` | `https://stage.communityeventsproject.com` |
| | `API_URL` | **unset on purpose** — production does not exist; a non-`calendar-stage@` address is dropped, not posted |
| | `CLOUDFLARE_EMAIL_SECRET` | a **secret** (not plain text), copied from v1's value on 2026-10-15 with Rob's OK — one value now authenticates to both v1 and v2 stage, so rotating it is a change on both sides |

v1's Worker holds its `CLOUDFLARE_EMAIL_SECRET` as a **plain-text variable**,
so any API token that can read Worker settings can read it. Worth moving to a
secret in the v1 repo's terms; not changed from here.

**`communityeventsproject.com`:**
- **DNS.** Apex, `www`, `stage`, `demo` → `74.83.52.104`, proxied.
  `*.stage` and `demo.stage` → same, **DNS-only** (Universal SSL covers one
  label). **`*` added 2026-10-15** → `74.83.52.104`, proxied, so a new tenant
  subdomain needs no DNS edit.
- **The wildcard reaches the origin, and the origin refuses it.** An unknown
  subdomain answers **525** (Cloudflare ↔ origin TLS handshake failed): Nginx
  Proxy Manager has no proxy host or certificate for names it has not been told
  about. Before the wildcard those names did not resolve at all, so nothing
  regressed — but a new tenant still needs an NPM host until NPM gets a
  wildcard host with a wildcard (DNS-challenge) or Cloudflare Origin CA cert.
- **Email Routing** enabled on the apex. Literal routes `noreply@` and `admin@`
  forward to Rob's Gmail, and the **catch-all forwards to Gmail too** — so until
  the calendar route exists, a stage RSVP reply lands in that inbox and never
  reaches the API.
- **Stage's reply address, verified** by fetching the stage root community's
  subscribed feed (same `contactsFor()` as the emailed invite):
  `ORGANIZER;CN=Community Events Project:mailto:calendar-stage@communityeventsproject.com`.
  Apex, so no subdomain onboarding. Only the **root** community was checked;
  stage's second community resolves its own `mail_domain`, and its replies need
  a route in *that* domain's zone.
- **Routed 2026-10-15:** `calendar-stage@communityeventsproject.com` →
  `communityevents_calendar` (literal rule, listed ahead of the Gmail catch-all).
  **`calendar@communityeventsproject.com` is not routed** and must not be until
  `API_URL` names a real production host.
- **Still needed on the stage container:** `CLOUDFLARE_EMAIL_SECRET` set to the
  same value. It was never set there, and `rsvp-reply` refuses everything when
  the env value is empty — fails closed, so until it is set every reply reaches
  the API and is answered 401, visible in the Worker's logs and nowhere else.

**`tippenhauerworks.com`:** set up from a separate session; not recorded here
yet. As audited it had no wildcard, no MX, Email Routing never configured, and
an apex on GoDaddy's site-builder addresses — so a wildcard copying the apex
would send every subdomain to GoDaddy.

**`dinnerbears.com`:** read, not changed. Literal routes for `calendar@` and
`calendar-stage@` → `dinnerbear_calendar`; `support@`, `hello@`, `admin@`,
`rob@` → Gmail; catch-all **drops**.

### Email credentials

A community on its **own domain** may not fall back to the deployment's Brevo
credentials (`v2-12`). DinnerBears brings its own key, From identity and
template ids. Template ids belong to the account that owns them — an id from
another account is a valid number pointing at nothing, and the provider refuses
the send.

Brevo webhooks are per-community and self-registering; re-register after the
cutover rather than assuming the v1 registration carries.

### OAuth

Each tenant supplies its own Google and Meta credentials (`v2-8`). A community
on its own domain registers its **own redirect URI** and takes the direct
callback (`v2-12`), so the redirect URI in both consoles has to be updated to
the new host before sign-in works. Google matches `redirect_uri` at the token
exchange too — a mismatch names neither side.

### Sessions

Cookies are host-only as of `v2-6`. **Every member re-logs in at cutover.**
Worth telling them beforehand rather than having it read as an outage.

### Muse

Re-issue its token in v2 (`api_tokens` rows are deliberately not imported) and
point it at the new base URL. Its contract is otherwise unchanged, which is the
reason `v2-29` keeps the API identical.

### Rollback

The v1 deployments are not deleted on cutover day. The import reads v1 over a
read-only connection and writes nothing to it, so rolling back is a DNS change
for as long as the old containers are left standing. Decide in advance how long
that is.

---

## What is explicitly deferred

`v2-15` (operator wizard), `v2-16` (handbook), `v2-17` (validation trail),
`v2-18`–`v2-23` (media, CMS, blocks, menus, discussion, photos), `v2-26` (dark
backgrounds), `v2-28` (SEO and link previews), `v2-30` (ban records), and the
unification half of `v2-27`.

`v2-31` (a real email log) is not a blocker but is wanted early — the admin
screen caps at 100 rows with no search, which stops answering "did this member
get their invite" at DinnerBears' volume within a couple of days.

---

## Open questions

1. ~~**How many cities does each source deployment actually carry?**~~
   **Answered by the one-tenant decision.** This was written when the plan was
   two tenants, where "one city each" would have made v2-24's multi-select dead
   weight. v1's single database already holds **both Cincinnati and Dayton**, so
   the imported tenant is multi-city on day one and the multi-select is required
   rather than speculative — a member wanting Dayton only, or both, is the
   ordinary case immediately. (Nothing "merges": there was only ever one
   deployment.)

   Each imported member has exactly one legacy city, so each gets one row in
   `user_city_preferences` — the earlier claim here, that a member with accounts
   in both databases would import with two, was a consequence of the
   two-database error and is withdrawn.
2. **The automation-account conflict** in `v2-29` — relax "one non-human account
   per tenant", or model integration accounts separately.
3. **How long the old v1 deployments stay up** after cutover as a rollback path.
4. **Email retention** (`v2-31`) — how long a sent row and its rendered body are
   kept, now that the log is a feature rather than a queue.
5. ~~**How an address held in both source databases becomes one account**~~ —
   **void, 2026-10-14.** There is one source database; see change 2.
6. ~~**Does v2 continue v1's version numbering?**~~ — **answered, 2026-10-14:
   yes.** v1's notes import with their real dates and a single `2.0` note
   follows them.
6. ~~**Which host survives**~~ — **answered, 2026-10-14.**
   `www.dinnerbears.com` is live and survives as the tenant's host;
   `stage.dinnerbears.com` is v1's test deployment and is the natural import
   rehearsal target. The city subdomains are unused and simply go.
7. ~~**Does the import preserve `users.calendar_token` and
   `push_subscriptions.endpoint`?**~~ — **measured 2026-10-14: 26 of 62
   members have a calendar feed, 3 have push.** Both become requirements;
   `REQ-IMPORT-01` still says nothing about either, and push additionally needs
   v1's VAPID keypair carried into production's env.
6. **Does v2 continue v1's version numbering at cutover**, or start fresh? See
   the release-notes section.
