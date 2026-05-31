# DinnerBears.com — Claude Code Project Context

## Project Overview
Community dining platform that organizes weekly group dinners across multiple cities.
Initial cities: Cincinnati and Dayton (cincinnati.dinnerbears.com, dayton.dinnerbears.com).
Self-hosted on Unraid using Docker Compose. Invite-only membership.

## Full Stack
- **Frontend:** Angular 19, standalone components (NO NgModules), Angular Material (MDC), SCSS
- **Backend:** NestJS (Node.js, TypeScript), TypeORM, Passport.js
- **Database:** MySQL 8.x
- **Auth:** JWT sessions + Google OAuth + Facebook OAuth (Passport strategies)
- **Email:** Brevo SDK (primary) + Nodemailer/Gmail SMTP (overflow fallback)
- **Push:** Web Push API with VAPID keys (@angular/pwa service worker)
- **Proxy:** NGINX Proxy Manager (Docker)
- **Containers:** Docker Compose — api and mysql have NO public ports

## Repository Structure
```
dinnerbears/
├── frontend/          # Angular 19 app
├── api/               # NestJS API (internal only — no public ports)
├── docker/            # Docker Compose and NGINX config
├── .claude/           # Claude Code project settings
└── CLAUDE.md          # This file
```

## Angular Conventions (STRICT — always follow these)
- **Standalone components only** — never use NgModules
- **Reactive Forms only** — never use template-driven forms (NgModel)
- **Typed services for all HTTP** — never call HttpClient directly in components
- **Angular Signals** for local state (not BehaviorSubject unless streaming)
- **Functional route guards** — use `CanActivateFn`, not class-based guards
- **Lazy-loaded routes** — each feature is a lazy route group
- **Angular Material** — use Mat components wherever one exists (buttons, forms, cards, dialogs, tables, snackbars, etc.)
- **Mobile-first** — design at 375px first, then 768px, then 1280px
- **BreakpointObserver** for responsive layout logic

## NestJS Conventions (STRICT — always follow these)
- **One module per domain** — UsersModule, AuthModule, RestaurantsModule, EventsModule, etc.
- **DTOs for all input** — class-validator + class-transformer decorators
- **ValidationPipe globally** — all invalid requests rejected at API boundary
- **TypeORM entities** — one entity per table, relations via decorators
- **Migrations for schema changes** — never edit DB manually
- **ConfigService** for all env vars — never access process.env directly in business logic
- **All routes prefixed /api/v1/**
- **Global exception filter** — never expose stack traces to clients
- **Passport guards** on all protected routes

## Security Rules (NON-NEGOTIABLE)
- Passwords hashed with Argon2id (or bcrypt work factor ≥12) — never plaintext
- All SQL via TypeORM parameterized queries — never raw string interpolation
- JWT tokens in HTTP-only, Secure, SameSite=Strict cookies — never localStorage
- All secrets in .env only — never hardcode credentials
- Server-side role checks on every protected route — never trust client-side roles
- Rate limiting via @nestjs/throttler on auth endpoints
- File uploads: validate MIME + extension server-side, store outside web root

## Database
MySQL 8.x. TypeORM entities and migrations in `api/src/database/`.
Key tables: users, invite_links, oauth_accounts, login_sessions, restaurants, events, rsvps,
announcements, comments, content_flags, notifications, push_subscriptions,
notification_preferences, email_queue, email_send_log, email_provider_config,
audit_log, cities.

## Environment Variables
All in `.env` (root) — never committed to git. See `.env.example` for required keys.
Key vars: DB_*, JWT_SECRET, GOOGLE_CLIENT_ID/SECRET, FACEBOOK_CLIENT_ID/SECRET,
BREVO_API_KEY, GMAIL_SMTP_*, NEXTAUTH_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
GEOCODING_API_KEY, FACEBOOK_GRAPH_TOKEN.

## Current Development Phase
**Phase 1 — Project Foundation & Design System**
Goal: Working Docker Compose scaffold, Angular shell with Material theme,
NGINX routing, NestJS health check. No business logic yet.

See PHASES.md for full phase breakdown.

## Key Business Rules
- Users can ONLY register via invite link (no open registration)
- Member invite links: single-use, 30-day expiry, tracks inviter
- Admin invite links: unlimited-use, admin-set time gate (max 30 days)
- All emails queued in MySQL — never sent inline
- Brevo limit: 300/day. Gmail overflow: 500/day. Combined ceiling: 800/day
- Soft delete accounts → 30-day recovery window → hard delete PII on day 30
- City context resolved from subdomain (cincinnati.*, dayton.*)
- Events are weekly; linked to restaurant records that pre-fill event fields
- OAuth (Google/Facebook) still requires a valid invite link to create an account
