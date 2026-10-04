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
| **Three bugfixes** (v1.6.1, 2026-09-30) | location snapshots on upcoming events; auto-invites when an event is created already published; release-note placeholders on the login splash |

All four are recorded in v1's `docs/PORT_TO_COMMUNITYEVENTS.md` with
`Ported: No`. Most of that landed in four days.

**The port list was growing faster than it was shrinking.** Two decisions on
2026-10-01 stop that:

- **v1 takes no new phases.** Phase 40 (Ban Records) moved here as `v2-30`
  before any v1 code existed, so it cost nothing. Bugfixes may still land in
  v1 — all three in 1.6.1 are "No DB changes" and a paragraph each — but a
  phase is weeks of porting.
- **The drift list is final at four entries.** Phase 39 and the three 1.6.1
  fixes. Nothing else will be added to it.

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

### Domains, and the `www` trap

`tenants.domain` is stored bare and **cannot hold a `www.` prefix** —
`normalizeTenantDomain` strips it, so `www.dinnerbears.com` and
`dinnerbears.com` resolve to one tenant row by design. Check the apex actually
has an A record before relying on it; in v1 the apex published MX only, which is
the whole reason `BASE_DOMAIN` was `www.dinnerbears.com` there.

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
