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
├── CLAUDE.md                  ← Root context file (Claude reads this first)
├── PHASES.md                  ← Phase breakdown with definitions of done
├── README.md                  ← Full setup instructions
├── .env.example               ← All required env vars documented
├── .gitignore
├── .claude/                   ← Claude Code settings
├── .vscode/                   ← VS Code settings
├── docs/                      ← Requirements, schema, setup guides
├── frontend/                  ← Angular 19 app
│   └── public/                ← Static placeholder site (landing, privacy, terms)
├── api/                       ← NestJS API
└── docker/                    ← Docker Compose and NGINX config
```

## Current Development Phase
**Phase 4.1 — Event Core**
See PHASES.md for full phase breakdown and definitions of done.

## Completed Phases
- **Phase 1** — Docker scaffold, Angular shell, NestJS + TypeORM, health check, ESLint/Prettier ✓
- **Phase 2** — Google OAuth, invite system, JWT sessions, profile page, photo upload ✓
- **Phase 3** — Restaurant database UI, photos, geocoding ✓
- **Phase 3.5** — Historical Facebook import, enrichment via Google Places + Claude AI ✓

## Angular Conventions (STRICT)
- **Standalone components only** — never use NgModules
- **Reactive Forms only** — never use template-driven forms
- **Typed services for all HTTP** — never call HttpClient directly in components
- **Angular Signals** for local state
- **Functional route guards** — use `CanActivateFn`
- **Lazy-loaded routes** — each feature is a lazy route group
- **Angular Material** — use Mat components wherever one exists

## NestJS Conventions (STRICT)
- **One module per feature** — AuthModule, UsersModule, RestaurantsModule, etc.
- **DTOs with class-validator** for all request bodies
- **Guards for all protected routes** — never trust client role state
- **TypeORM repositories** — no raw SQL except in migrations
- **Global prefix** `/api/v1` set in main.ts
- **Never expose stack traces** — GlobalExceptionFilter handles all errors

## Database
- MySQL 8.x via TypeORM
- `synchronize: false` always — migrations only
- Migrations in `api/src/database/migrations/` with timestamp prefix
- See `docs/DATABASE_SCHEMA.md` for full schema

## Key Files for Context
- `docs/REQUIREMENTS.md` — all 107 product requirements
- `docs/DATABASE_SCHEMA.md` — all 25 tables with columns and indexes
- `docs/PHASES.md` — phase breakdown (same as root PHASES.md)
- `docs/FACEBOOK_APP_SETUP.md` — Facebook OAuth setup guide
