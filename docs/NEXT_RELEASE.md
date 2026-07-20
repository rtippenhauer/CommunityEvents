# Next Release — Draft Notes

Running draft of unreleased, customer-facing changes. Appended to automatically
by `/phase-done` when a phase wraps, and by hand for ad hoc work in between.
`/release` uses this file as the starting draft and clears it back to empty
once that release's draft has been created.

## Event Achievements (Phase 28)
- Marking or unmarking a dinner as a secret dinner now automatically keeps
  points and badges in sync for members who already attended — no more
  stale totals if the flag changes after the fact.
- Special one-off dinner achievements can now be removed if added by
  mistake, and removing one properly cleans up everyone who'd already
  earned it.
- Newly added dinner achievements are now automatically granted to members
  who already attended that dinner, instead of only future attendees.
