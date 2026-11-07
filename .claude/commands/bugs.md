Work on open bug tickets.

1. Call `GET /api/v1/admin/feedback/open-bugs` to retrieve all open bug tickets.
2. Present the list to Rob and ask which to work on.
3. Implement the fix.
4. Call `PATCH /api/v1/admin/feedback/:id/status` with `{status: "resolved"}` on
   the fixed ticket.
5. Add an admin note via `POST /api/v1/admin/feedback/:id/notes` summarising
   what was changed.

Authentication is a cookie, not a bearer token:
`Cookie: access_token=<...>`, minted with `CLAUDE_AUTOMATION_SECRET` from the
repo-root `.env`. `automationLogin` works on the root tenant anywhere, and on a
non-root tenant only on a stage deployment.

Fixes follow the ordinary branch rule — reuse the current v2 item's branch if
one is in progress, otherwise cut a short-lived `bugfix-<slug>`.
