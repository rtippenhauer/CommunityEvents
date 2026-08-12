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
