Run the 20-point security checklist below against the current codebase and
report PASS / FAIL / N/A for each point with a one-line reason and a
file:line reference. Then fix every FAIL, in order of severity, and report
what changed.

Adapted from a generic Next.js/Vercel checklist to this project's actual
stack (NestJS + TypeORM + MySQL, JWT cookie auth, self-hosted behind NGINX
Proxy Manager on Unraid) — treat items that reference NextAuth/Vercel as
N/A and check the equivalent mechanism instead.

1. Passwords are hashed (bcrypt or argon2), never stored in plain text.
2. Session tokens are in httpOnly cookies (not accessible by JavaScript).
3. The JWT/session signing secret is a real random value, not a placeholder,
   and isn't committed anywhere.
4. Login endpoint has rate limiting (5 attempts/min/IP or tighter).
5. Password reset tokens expire within 1 hour and are single-use.
6. All user inputs are validated server-side (DTOs + class-validator), not
   just client-side.
7. HTML is sanitized from all rich-text inputs (sanitize-html or
   equivalent) to prevent stored XSS.
8. Input lengths are capped (`@MaxLength`/column limits) to prevent memory
   exhaustion / oversized payloads.
9. File uploads are validated for type and size.
10. API endpoints reject unexpected/extra parameters (e.g.
    `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`).
11. Every query that fetches or mutates a specific user's data includes an
    ownership/authorization check (no IDOR — one member can't read or edit
    another's data by guessing an ID).
12. No raw SQL string concatenation; all queries are parameterized
    (TypeORM query builder / repository methods only, per
    `api/CLAUDE.md`).
13. API responses don't leak sensitive fields (password hashes, tokens,
    other members' emails) — check DTOs/serializers on public and
    semi-public endpoints.
14. Admin and moderator endpoints require role verification server-side via
    guards, not just UI hiding.
15. "Deleted" data is actually removed or anonymized per the account
    deletion / hard-delete cron spec, not just hidden behind a flag
    indefinitely.
16. `.env` files are in `.gitignore` and never committed; `.env.example`
    has no real secret values.
17. No hardcoded secrets/API keys/credentials in source (grep for likely
    patterns, check config/env usage).
18. `npm audit` shows zero high/critical vulnerabilities in both
    `frontend/` and `api/` (runtime deps — build-only tooling that never
    ships in the Docker image doesn't count, per the Phase 14 backlog
    precedent).
19. HTTPS is enforced at the edge (NGINX Proxy Manager) and cookies are
    marked `secure` in production.
20. CORS is configured to allow only DinnerBears' own domains, not `*`.

Report format: a numbered list, PASS/FAIL/N/A + one-line evidence per item,
followed by a fix plan for any FAILs. Confirm with Rob before fixing
anything destructive or before changing auth/cookie/CORS config in a way
that could lock out sessions. Don't bump `package.json` version or touch
`docs/NEXT_RELEASE.md` here — that's `/phase-done`'s job once this phase is
marked complete.
