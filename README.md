# DinnerBears.com

Community dining platform for weekly group dinners in Cincinnati and Dayton.
Invite-only. Self-hosted on Unraid via Docker Compose.

## Stack
- **Frontend:** Angular 19 + Angular Material
- **API:** NestJS + TypeORM
- **Database:** MySQL 8
- **Auth:** Google OAuth + Facebook OAuth + Email/Password (phased)
- **Email:** Brevo + Gmail SMTP fallback
- **Proxy:** NGINX

## Quick Start

### Prerequisites
- Node.js 20 LTS
- Docker Desktop (local dev) or Unraid (production)
- Git

### Setup

```bash
# Clone
git clone https://github.com/rtippenhauer/DinnerBears.git
cd DinnerBears

# Copy and fill in environment variables
cp .env.example .env
# Edit .env with your credentials

# Install dependencies
cd frontend && npm install && cd ..
cd api && npm install && cd ..

# Start development servers
cd api && npm run start:dev       # NestJS on port 3000
cd frontend && npm start          # Angular on port 8080
```

### Docker (Production/Unraid)

```bash
docker compose -f docker/docker-compose.yml up -d
```

## Documentation
- `PHASES.md` — Development phases and definitions of done
- `docs/REQUIREMENTS.md` — Full product requirements (107 items)
- `docs/DATABASE_SCHEMA.md` — MySQL schema (25 tables)
- `docs/FACEBOOK_APP_SETUP.md` — Facebook OAuth setup guide

## Claude Code
Open this folder in VS Code with the Claude Code extension installed.
Claude reads `CLAUDE.md` automatically for project context.
Ask: *"What is this project and what phase are we in?"* to verify setup.
