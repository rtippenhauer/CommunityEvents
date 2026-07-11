# Next Release — Draft Notes

Running draft of unreleased, customer-facing changes. Appended to automatically
by `/phase-done` when a phase wraps, and by hand for ad hoc work in between.
`/release` uses this file as the starting draft and clears it back to empty
once that release's draft has been created.

## Phase 20 — Reliability Fixes from Expanded Test Coverage

- Fixed: successfully inviting a member who then attends their first dinner now
  correctly awards you a Bear Point and the "Connector" achievement — this had
  silently never worked before.
- Fixed: per-email notification preferences (e.g. opting out of invite emails)
  are now actually honored — a bug meant these toggles had no effect.
- Fixed: replying Accept or Decline to a dinner invite from iOS Calendar now
  reliably updates your RSVP — some replies were previously silently dropped.
- Fixed: subscribing to push notifications with an incomplete request now
  returns a clear error instead of a server failure.
