# DinnerBears API — NestJS

## Conventions (STRICT)
- One module per feature domain
- DTOs with class-validator for all request bodies
- Guards on all protected routes — never trust client role state
- TypeORM repositories — no raw SQL except in migrations
- Global prefix /api/v1 set in main.ts
- Never expose stack traces — GlobalExceptionFilter handles all errors
- synchronize: false always — migrations only

## Module Structure
src/modules/
├── auth/           # JWT, Google OAuth, Facebook OAuth, strategies
├── users/          # User CRUD, profile, account management
├── restaurants/    # Restaurant CRUD, geocoding, photos
├── events/         # Event CRUD, RSVP, guest RSVP, calendar export
├── announcements/  # Announcements, comments, flagging
├── notifications/  # In-app notifications, push, SSE
├── admin/          # Admin-only endpoints
└── email/          # Queue, dispatcher, Brevo, Gmail SMTP

## Security Checklist (enforce on every endpoint)
- [ ] JWT guard applied
- [ ] Role guard applied where needed
- [ ] DTO validation with class-validator
- [ ] Parameterized queries only (TypeORM)
- [ ] File uploads: MIME + extension validation

## Database
- Migrations in src/migrations/ with timestamp prefix
- Never use synchronize: true
- See docs/DATABASE_SCHEMA.md for full schema reference

## Port
NestJS runs on port 3000 (internal only — no public port)
