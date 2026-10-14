# Cutover plan — DinnerBears onto CommunityEvents

**Status:** Draft, 2026-10-01. The plan for retiring the two v1 DinnerBears
deployments and running them as tenants of this one.

The backlog in `V2_PHASES.md` is fourteen open items. **Five of them stand
between here and a live DinnerBears**, and nine do not. This document is the
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

## The test for "is this a blocker"

**Does DinnerBears have it today?** If not, going live without it is parity,
not regression, and it belongs after the cutover. That single question moves
nine of the fourteen open items off the critical path, including the entire
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

**2. Answer the email-collision question now, before `v2-25` needs it.** Email
is unique per tenant (`@@unique([tenantId, email])`) and DinnerBears is **one**
tenant spanning two cities, so an address holding an account in both the
Cincinnati and the Dayton database is two rows that must become one. This is
the single open design question that can stall the *end* of the project, when
everything else is finished and a dry run is sitting on a conflict. It is a
decision, not code; it costs nothing today. `REQ-IMPORT-01` is marked
superseded in part until it is answered.

What has to be decided: which row wins for profile fields, what happens to two
different password hashes, whether both cities' RSVP and points history merge
onto the survivor, and what the member is told. The merge rule should be
written into `REQ-IMPORT-01` and exercised by a dry run against a copy of both
databases — the count of colliding addresses is itself a thing to measure
early, because it may be two people or two hundred.

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

**A decision still needed:** v2's `package.json` is still v1's `1.5.1` and
there is no `/v2-release`. At cutover, does v2 continue v1's numbering (…1.6.4,
then 2.0) or start fresh? `releases.version` is a unique `VARCHAR(20)` and
holds either, so this is a presentation choice rather than a technical one —
but the splash orders by date, so whatever is chosen, the dates have to be
right.

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

Not a numbered item because it is operations rather than code, and it does not
exist in any form yet:

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

---

## The cutover itself

Code being ready is not the same as being live. These are the steps that happen
on the day, and most have bitten this project before in some form.

### Tenancy shape

**DinnerBears is one tenant. Cincinnati and Dayton are cities inside it**
(Rob, 2026-10-03).

This reverses what this section said, and the reversal is the right way round:
it said two source databases become two independent tenants, reasoning from how
v1 *runs today* rather than from what a tenant *is*. v1 runs two deployments
because v1 had no other way to run two cities — that is the constraint v2 exists
to remove, so treating it as the target shape would have carried the old
limitation across the cutover and called it a requirement. A tenant is a
community; DinnerBears is one community that meets in two cities.

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

`tenants.domain` is stored bare and **cannot hold a `www.` prefix** —
`normalizeTenantDomain` strips it, so `www.dinnerbears.com` and
`dinnerbears.com` resolve to one tenant row by design. Check the apex actually
has an A record before relying on it; in v1 the apex published MX only, which is
the whole reason `BASE_DOMAIN` was `www.dinnerbears.com` there.

**Retiring a host is not deleting its DNS record.** Four things members already
hold are bound to a hostname, and only one of them fails in a way anybody
notices:

| What | If the host just disappears |
|---|---|
| **iCal feed subscriptions** | **Silent.** `feedUrl` builds `https://<tenant host>/api/v1/calendar/feed.ics?token=…` and the member pasted that into Google or Apple Calendar months ago. A dead host makes the client stop refreshing; it does not tell anybody. The member simply stops seeing dinners and assumes none are scheduled. |
| **Web push subscriptions** | **Silent.** A push endpoint belongs to the service-worker registration, which is per *origin*. A member who installed the PWA from `dayton.dinnerbears.com` has a subscription that cannot be moved to another host at all — `push_subscriptions.endpoint` is unique and origin-bound, so it has to be re-created by that member visiting the new host. |
| **Links in already-sent email** | Semi-visible. Invite, event and reset links in mail already delivered point at the old host and cannot be rewritten. They fail as a dead link rather than a wrong page. |
| **OAuth redirect URIs** | **Loudly**, which makes it the good case: Google answers `redirect_uri_mismatch`. Register the surviving host and drop the others as part of the cutover. |

So the retired hosts should keep answering **301 redirects to the surviving
host for a long window** rather than being removed. That rescues bookmarks and,
on most clients, the calendar feeds — both Google and Apple follow a permanent
redirect on a later refetch. It cannot rescue push.

**But a redirect only helps if the token still resolves, and that is an import
question nothing has answered.** `users.calendar_token` is a `VARCHAR(36)`
unique column; `REQ-IMPORT-01` does not mention it anywhere. If the import
carries each member's existing token across, a redirect makes every subscribed
feed keep working. If it generates fresh tokens, **every feed in the community
breaks the moment the old hosts go**, redirects or not, and the only remedy is
asking every member to re-subscribe — which most will not do. Preserving
`calendar_token` should be an explicit import requirement.

**It also collides with the email question above.** A member holding an account
in both source databases has *two* calendar tokens, and the merged account can
keep only one — so one of their two subscribed feeds dies whatever the
redirects do. Whoever that affects needs telling directly, which is another
reason to measure how many addresses actually collide before the cutover rather
than during it.

### Mail domain — set it explicitly, never derive it

`mail_domain` is a per-tenant `app_config` row and **must not be derived from
the tenant's host**. A tenant subdomain normally publishes no MX record, so
`hello@dayton.dinnerbears.com` would bounce silently. v1's Phase 38 was partly
a fix for exactly this. Set each tenant's mail domain as part of creating it.

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

1. **How many cities does each source deployment actually carry?** If each has
   exactly one, v2-24's multi-select is dead weight at cutover and could ship
   thinner. If a deployment already runs several, the full feature is needed.
2. **The automation-account conflict** in `v2-29` — relax "one non-human account
   per tenant", or model integration accounts separately.
3. **How long the old v1 deployments stay up** after cutover as a rollback path.
4. **Email retention** (`v2-31`) — how long a sent row and its rendered body are
   kept, now that the log is a feature rather than a queue.
5. **How an address held in both source databases becomes one account** — see
   change 2 above. The question that can stall the end of the project, and the
   only one on this list that is free to answer today. Now also carries which
   of the member's two `calendar_token`s survives.
7. **Which host survives** — `www.dinnerbears.com` is the presumption, but the
   two deployments' current hostnames are not recorded here and the retired
   ones need naming before redirects can be written.
6. **Does v2 continue v1's version numbering at cutover**, or start fresh? See
   the release-notes section.
