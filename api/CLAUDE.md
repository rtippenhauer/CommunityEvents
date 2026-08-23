# CommunityEvents API — NestJS

## Conventions (STRICT)
- One module per feature domain
- DTOs with class-validator for all request bodies
- Guards on all protected routes — never trust client role state
- Prisma for all data access (v2-1) — raw SQL only where Prisma cannot
  express the statement, and say why in a comment at the site
- Global prefix /api/v1 set in main.ts
- Never expose stack traces — GlobalExceptionFilter handles all errors
- Migrations are Prisma's: `prisma migrate dev` locally, `prisma migrate deploy`
  in the container entrypoint
- Tests are Vitest: `npm test` for unit specs under `src/`, `npm run test:e2e`
  for the Supertest suites in `test/`
- **Never encrypt or decrypt a secret by hand** (v2-7) — the Prisma extension
  does it for every column in `src/common/crypto/encrypted-columns.ts`, so
  services read and write plaintext. Adding an encrypted column means adding it
  to that list, not calling the cipher. Raw SQL is the one exception, as with
  tenant scoping. An encrypted column can never be filtered or ordered on; the
  extension throws rather than returning an empty result. See `docs/SECRETS.md`.
- **Never return a stored credential in a response.** The admin email endpoint
  answers with `brevoApiKeySet: boolean`, and `/admin/secrets` lists only where
  each key resolves from. Decrypting at the database edge and re-exporting at
  the HTTP edge would leave the value in an access log and a browser cache.
- **The encryption key never goes in the database.** A dump holding the key and
  the ciphertext is a dump of the plaintext. The database may hold a
  *fingerprint* — every envelope already names its key id — which is what
  `secret-key-bootstrap.ts` uses at startup to decide whether generating a key
  is safe and to refuse a key that cannot read what is stored.

## Module Structure
src/modules/
├── auth/           # JWT, Google OAuth, Facebook OAuth, strategies
├── users/          # User CRUD, profile, account management
├── locations/      # Location CRUD, geocoding, photos (displayed as "Restaurant" in the UI)
├── events/         # Event CRUD, RSVP, guest RSVP, calendar export
├── announcements/  # Announcements, comments, flagging
├── notifications/  # In-app notifications, push, SSE
├── admin/          # Admin-only endpoints
└── email/          # Queue, dispatcher, Brevo, Gmail SMTP

## Security Checklist (enforce on every endpoint)
- [ ] JWT guard applied
- [ ] Role guard applied where needed
- [ ] DTO validation with class-validator
- [ ] Parameterized queries only (Prisma; bind params in `$queryRaw` too)
- [ ] File uploads: MIME + extension validation

## Database
- `prisma/schema.prisma` is the single source of truth; migrations live in
  `prisma/migrations/`. `docs/DATABASE_SCHEMA.md` is reference only and may drift.
- Fresh install: `prisma migrate deploy` -> `dist/database/prisma/seed.js` ->
  `dist/bootstrap.js`, in that order.
- Scalar fields are camelCase with `@map` to snake_case columns — the field name
  is the JSON key the frontend consumes, so do not rename casually.
- DATE/TIME columns come back as `Date`; use
  `src/common/utils/prisma-date.util.ts` rather than string-slicing them.
- Four `locations` columns are hidden by a global `omit` in PrismaService
  (moderator notes, contact name/phone/email). Only the moderator read opts in.

## Testing
- `npm test` — unit specs (`src/**/*.spec.ts`), `vitest.config.mts`
- `npm run test:e2e` — the 28 suites in `test/`, `vitest.config.e2e.mts`.
  Needs the throwaway MySQL from `docker/docker-compose.test.yml`;
  `bash scripts/run-e2e-tests.sh` brings it up, runs them and tears it down.
- `test/global-setup.ts` applies the schema once per run (`prisma migrate
  deploy`). TypeORM used to do this implicitly at app.init(); Prisma has no
  connection-time equivalent.
- Every spec truncates the whole database in `beforeEach`, hence
  `fileParallelism: false`. `truncateAllTables` refuses to run against a
  database whose name does not end in `_test`.
- unplugin-swc is required, not cosmetic — NestJS reads `design:paramtypes`,
  and Vite's default esbuild transform emits no decorator metadata.
- Raw `$queryRaw` results give integer columns back as **BigInt**. Pass them
  through `coerceRawRows` (`src/common/utils/prisma-raw.util.ts`) or they blow
  up later, either inside Prisma or inside JSON.stringify.
- `update()`/`delete()` by id **throw P2025 when the row is gone**, where
  TypeORM's reported `affected: 0`. Use `updateMany`/`deleteMany` unless
  something guarantees the row still exists. Four separate regressions have come
  from this; in a scheduled task it is worse than a 500, because it becomes an
  unhandled rejection that fails invisibly.

## Port
NestJS runs on port 3000 (internal only — no public port)
