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
