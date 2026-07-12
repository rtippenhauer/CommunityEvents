# Next Release — Draft Notes

Running draft of unreleased, customer-facing changes. Appended to automatically
by `/phase-done` when a phase wraps, and by hand for ad hoc work in between.
`/release` uses this file as the starting draft and clears it back to empty
once that release's draft has been created.

## Reliability & Security Hardening

- Tightened server-side validation across several admin tools (achievements,
  custom icons, email settings, member titles) so invalid or oversized input
  is now rejected with a clear error instead of silently going through or
  failing unexpectedly
- Announcements now go through the same content-cleaning pass as feedback and
  release notes, closing a small inconsistency between those areas
- Added a large batch of automated tests specifically probing oversized
  input and malicious-looking text across the platform, confirming the app
  handles it safely everywhere it was checked
