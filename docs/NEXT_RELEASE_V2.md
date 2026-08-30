# Next Release — v2 Draft Notes

Running draft of unreleased, customer-facing changes for the CommunityEvents
v2 rewrite. Separate from `docs/NEXT_RELEASE.md` (v1/dinnerbears — frozen,
no further v1 releases planned before 2.0) so the two don't mix. Appended to
automatically by `/v2-done` when a v2 item wraps, and by hand for ad hoc v2
work in between. There is no `/v2-release` yet — Rob will trim this down
into the actual 2.0 release copy by hand when that cutover happens.

---

## Platform / data layer

**Rebuilt on a new data layer.** The application's database access has been
completely rewritten. This is invisible from the outside — the same pages,
the same data — but it's the foundation the multi-community work is built on,
and nothing else could start until it was done.

Two things that were quietly wrong are now right:

- **Event and dinner times are handled correctly regardless of server
  timezone.** Previously the way dates came back from the database depended on
  the server's own clock settings, which could shift displayed times.
- **Restaurant contact details and internal moderator notes are properly
  hidden** from ordinary members. They were always meant to be admin-only.

**Installing a new community instance is simpler.** Setting up a fresh
instance is now three clear steps — create the database structure, load the
starting data, then configure the instance — replacing a long chain of
incremental upgrade steps accumulated over the life of v1.

---

## Reliability

**Several pages that had stopped working are fixed.** The rebuilt data layer
introduced a handful of faults that were invisible until a proper test suite
existed to find them:

- **The leaderboard and the member directory** were returning errors instead
  of loading.
- **The admin audit log's member search** failed on every search.
- **Event dates and times displayed incorrectly** — an event could show on the
  wrong day, and the time was wrong when creating a new event.
- **Posting or editing an announcement, a feedback reply or a release note**
  failed.
- **Removing a points entry** could error instead of quietly doing nothing when
  the entry had already been removed.

**Three member avatars no longer appear broken.** The BBQ, DJ and NASCAR bears
pointed at filenames that did not exist on the server.

**Setup problems now explain themselves.** When location search is
unconfigured, it says so in the logs instead of silently returning no results —
previously an instance missing its Google Places key looked exactly like a
search that simply found nothing. Two required settings that the setup guide
never mentioned are now documented.

---

## Multi-community groundwork

**Communities are now a thing the system knows about.** A new `tenants` table
records each community — its web address, its status, and which one is the
root. Nothing visible changes yet: the current site is simply registered as its
own root community, and every page behaves exactly as before. This is the
record everything else in the multi-community work hangs off, and it had to
exist before a single page could be scoped to a community.

Two properties are enforced by the database rather than by convention, because
getting either wrong would be a security problem rather than a bug:

- **There can only ever be one root community.** An admin of the root community
  is the system administrator, so a second one would silently mean a second
  system administrator.
- **`www.example.com` and `example.com` are the same community, always.** The
  address is stored in one canonical form, so the two can never drift into
  separate records with separate data.

**Setting up an instance got simpler, not harder.** The root community's
address is taken from the instance's own URL, so there is no new setting to
configure — a staging and a production instance still differ by exactly one
value, as they always have.

## Reliability

**Scheduled background work no longer stops on a vanished record.** The email
dispatcher processes a batch of queued messages, and a message cancelled or
cleaned up mid-batch would cause the run to fail rather than skip it. The same
applied to the inactivity sweep, and to cancelling an already-cancelled email
from the admin queue.

---

## Community web addresses

**The site now works out which community you're asking for from the web
address you used.** Every page request is matched to a community before
anything loads. Nothing changes for an existing visitor — the current site is
its own community and behaves exactly as it always has — but this is the piece
that makes one installation able to serve several communities instead of
running a separate copy of everything for each one.

**`www.example.com` and `example.com` are always the same community.** They
share one address record, so there is no way for the two forms to end up as
separate communities with separate members and events.

**A web address with no community on it now gets a real page.** Previously an
unrecognised address would have loaded a half-working site with no name, no
branding and nothing on it. It now shows a short "Welcome to Community Events"
page explaining that there's no community at that address and suggesting the
visitor check the address they used. Mistyped addresses and old links are the
normal way people arrive at one of these, so it reads as an explanation rather
than an error.

**A community can be taken offline temporarily.** Suspending one shows visitors
a "temporarily unavailable" message instead of the site, and it comes back
exactly as it was when un-suspended.

**A half-finished installation now says so.** If an instance's database is
created but the final setup step was never run, every page used to look like a
wrong web address. It now reports that setup is unfinished, and says so in the
server logs too, so the person installing it is pointed at the actual problem
instead of hunting for a DNS mistake.

**The status check reports which community answered.** The existing health
check now also says whether the address it was reached on matched a community.
For anyone running an instance, a single check now distinguishes "the server is
fine, that address is wrong" from "this instance was never finished" — the two
setup problems that otherwise look identical from outside.

---

## Community data separation

**Each community's data is now genuinely its own.** Events, restaurants,
RSVPs, comments, announcements, invites, photos, ratings, points, badges,
notifications and feedback all belong to a specific community, and one
community can never see or change another's — even when someone asks for a
record by a number that really exists somewhere else. Requesting another
community's event returns "not found" rather than the event.

This is what makes a single installation able to host more than one community
safely. Previously that took a separate copy of the whole application and its
own database per city.

**It's enforced in one place rather than remembered everywhere.** Rather than
asking every part of the application to filter by community and hoping none of
them forgets, the separation is applied automatically at the data layer, which
every part of the application goes through. Code that forgets to filter is the
kind of mistake that quietly returns *more* than it should, so it can't be left
to individual pages to get right.

**It fails safe.** If anything ever asks for community-owned data without
knowing which community it's for, the request is refused rather than answered
with everything. Scheduled background jobs that legitimately work across all
communities — sending queued email, reminders, account cleanup — say so
explicitly.

**Two long-standing correctness bugs fixed along the way.** Earning a badge or
a point in one community used to be able to silently block the identical award
in another, because those records were keyed in a way that didn't account for
communities existing. The same person can now earn the same badge in each
community they belong to.

**A fix for administrator activity records.** Nightly account-cleanup was
failing to write its entry to the administrator activity log. The work itself
completed, but the record of it was being dropped.

## Setting up and populating an instance

**New communities can be added from the command line.** An operator can add a
community to a running installation, with its web address handled the same way
the application resolves visitors' addresses — so a community added this way
resolves exactly as expected rather than by a slightly different rule.

**Optional automatic setup on first start.** A brand-new installation can now
seed its reference data and create its first community and administrator by
itself, rather than requiring two manual steps. It's off by default and only
ever acts on a genuinely empty installation, so restarting an existing
instance never re-runs setup or overwrites settings an administrator has since
changed.

**Sample data for evaluating an instance.** A new command fills a community
with realistic members, restaurants, past events, attendance and reviews, so
the member directory, leaderboard and ratings pages can be judged with
something in them. Intended for demonstration and test installations, and it
refuses to run unless the operator names the database it is being pointed at.

---

## Accounts belong to a community

**Your account now belongs to the community you joined.** Signing in resolves
against the community whose web address you used, so the same email address can
hold a separate, independent account in each community — one for the group you
attend on Tuesdays, another for the one you joined in a different city, with
their own profiles, points and history. Previously an address could exist only
once across the whole installation.

**Staying signed in to one community no longer signs you in to another.** Your
session belongs to the exact web address that issued it. Signing out of one
community, or having your session expire there, leaves the others alone.

**Signing in with an email address and password works everywhere.** Signing in
with Google currently works on the main community only; the others offer email
and password until that is finished.

---

## Contact addresses per community

**Each community controls the addresses its email and calendar entries come
from.** The reply-to address shown to members, the organiser address on calendar
subscriptions, and the sender on event invitations can each be set in Site
Settings, so a community's mail carries its own identity rather than the
installation's.

Left blank, each of these carries on exactly as before — a community that never
opens the page sees no change. A community that receives mail on a domain of its
own can name it, and the rest follow from it automatically.

---

## Running several communities

**Communities are managed from one screen.** An operator running more than one
community can see all of them in one place, with the number of members, events
and restaurants in each, and can add, edit, suspend or restore any of them.

**A new community arrives ready to use.** Creating one now sets up its first
administrator at the same time, so somebody can sign in and start inviting
members immediately. Previously a newly created community had no way in at all —
joining required an invitation, and invitations required an existing member.

**People inside a community can be managed from outside it.** An operator can
list a community's members, change roles, suspend or restore an account, and set
a password. This exists for the case that used to be unrecoverable: a community
whose only administrator has left or forgotten their password, whose own
administration pages nobody can reach.

**Communities can be removed.** Deleting one permanently removes it and
everything in it, so it takes three deliberate steps: the community must already
be suspended, the operator retypes its web address, and the confirmation states
exactly how many members, events and restaurants are about to be destroyed.
Suspending remains the ordinary way to take a community offline — immediate,
reversible, and it deletes nothing.

---

## Administration

**Clearer separation between running a community and running the
installation.** Administering a community and administering the whole
installation are now distinct roles. A community's administrator manages that
community; only the installation's operator manages the registry of communities,
and only from the main community's address.

**Settings pages read correctly again.** Explanatory text under the fields on
the community setup form was overlapping the fields beneath it.

---

## Stored credentials

**Every credential in the database is encrypted.** Provider API keys, each
community's own third-party keys, and the sign-in credentials a community will
supply for Google and Facebook are all stored encrypted rather than as readable
text. A copy of the database is no longer a copy of the credentials in it.

**The encryption key is never stored alongside what it protects.** It lives with
the installation's start-up settings, not in the database, because a backup
holding both would be a backup of the plain values. A brand-new installation
generates its own key on first start and says, loudly, that it needs backing up.

**The installation refuses to start rather than run half-readable.** If it is
given a key that cannot read what is already stored, it stops and names the key
it needs, instead of starting up healthy and then failing at the moment somebody
sends an email or looks up an address.

**Changing the key costs nothing and loses nothing.** The old key is kept for
reading while a background task moves every stored value onto the new one, with
the installation serving normally throughout. Losing the key entirely is the
one unrecoverable case, so clearing out the unreadable values is a separate,
explicitly destructive step that makes the operator type a confirmation phrase.

**A stored credential is never sent back out.** Administration pages report
whether a key is set, never what it is — so a credential cannot end up in a
browser cache, a proxy log or a screenshot.

## Per-community API keys

**Three services can now be paid for by the community that uses them.** Address
lookup, place details and the assisted description writer each accept a key per
community, set on a new API Keys page. Usage is billed to whoever owns the key.
A community that sets none keeps working on the installation's own key, so
nothing changes for an existing setup until somebody chooses otherwise.

## Invitations

**An invitation is no longer discarded when the browser is already signed in.**
Opening an invite link while signed in used to bounce to the profile page with
the invitation silently dropped — the same link worked in a private window,
which made it look like a broken invitation rather than a signed-in browser.
It now says which account is signed in and offers to sign out and continue, with
the invitation intact.

**Invitation email describes the community that sent it.** The wording claimed
its recipients love good food and great company, which was true of one community
and an assumption about every other. It now carries the community's own tagline,
and nothing at all when that is blank.

## Terms and privacy

**Every community starts with a Terms of Service and a Privacy Policy.** A newly
created community had neither, so both pages appeared with a heading and nothing
under them — which reads as finished rather than missing. Each community now
starts from the platform's own documents, with its name and contact address
filled in as the pages are served, so renaming a community keeps them correct.

**Administrators are asked to read them.** Because the starter documents look
finished, nothing would otherwise prompt anyone to check them. A notice appears
for a community's administrators until somebody confirms the two documents, and
a single button restores the starter copy if a community wants to begin again.

## Email per community

**Each community sends its own email, under its own name.** A community can now
hold its own email provider account, its own From address and its own daily
allowance, set at Administration → Email. Mail from one community no longer
leaves under another's name, and a community that sets nothing keeps sending
exactly as before, on the deployment's own account.

**One community's administrator can no longer change another's.** The email
settings were previously a single set shared by the whole deployment, so an
administrator of any community could rewrite the sending credentials and From
identity that every other community sent under — usually without realising it.
Those settings now belong to the community being administered.

**Bounce handling is set up with one button.** Telling a provider where to
report bounces and unsubscribes used to be a manual step with a shared password
copied by hand. A community's connection is now registered for it, its
credential is generated rather than chosen, and it is replaced on a schedule
without anyone doing anything. A connection that was set up by hand earlier is
adopted rather than duplicated, so there is nothing to tidy up first.

**A community is warned before its provider key stops working.** Brevo
deactivates an API key after 90 days without a send, which is a real prospect
for a quiet community and gives no warning of its own. The email screen now says
so at 60 days, while there is still time to do something about it.

**The email settings screen works for a community that has never used it.** A
newly created community got a spinner that never resolved, on the one screen
that could have configured email in the first place.

**The daily send counter counts everything, and counts it against the right
day.** Two faults: messages sent immediately rather than queued — password
resets, address verification, security alerts — were never counted at all; and
the sending day ended at midnight UTC regardless of the operator's own calendar,
which for a US operator is the early evening. Together they meant the screen
could report two messages when four had been sent. Both are fixed, and the day
boundary is now a deployment setting (`EMAIL_QUOTA_TIMEZONE`).

**Sending stops before the provider cuts it off, even across communities.** A
sending allowance belongs to the provider account, and communities without their
own key share one. Each counting only its own sends meant several communities
could exceed a shared allowance without any of them exceeding what it believed
was its budget. The screen now shows both figures — what this community sent,
and what the account has left — and the second is what decides whether a message
goes out.

