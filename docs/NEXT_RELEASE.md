# Next Release — Draft Notes

Running draft of unreleased, customer-facing changes. Appended to automatically
by `/phase-done` when a phase wraps, and by hand for ad hoc work in between.
`/release` uses this file as the starting draft and clears it back to empty
once that release's draft has been created.

## Cities & Chapters

- Admins can now add and edit chapter cities directly from the admin panel —
  no code deploy needed to launch a new chapter.
- Signup, Events, Restaurants, Leaderboard, Members, and the homepage's
  upcoming-dinners preview now correctly default to your chapter's city
  instead of showing a mix of every chapter.
- Logging in with Google now keeps you on the chapter subdomain you started
  from instead of bouncing you to the wrong one.
- Sessions now stay valid across all of a chapter's subdomains rather than
  breaking when redirected between them during login.
- Visiting an unrecognized or mistyped domain now redirects to the site's
  main page instead of showing a broken chapter-specific view.

## Admin Panel

- Reorganized the admin nav into Security, Settings, and Members submenus
  nested under a single Admin menu, plus a dedicated Releases entry.
- New "Recalculate Points" button on the Achievements page re-syncs every
  member's earned-achievement points to that achievement's current point
  value, fixing leaderboard totals that drifted after a point value was
  edited.

## Restaurants

- Admins can now restore a soft-deleted restaurant via a new "Archived"
  toggle on the Restaurants page.
- Enrichment now also corrects a restaurant's address (and re-syncs its map
  location) from Google Places, not just phone/website/photos/description.

## Merch

- New Merch page linking to the DinnerBears Printful store, plus an
  exclusive item visible only to members with the Founding Bear achievement.

## Events

- Fixed a bug where assigning or reassigning a Reservation Coordinator
  showed a success toast but didn't update the event card until the page
  was refreshed — it now updates immediately.
