# DinnerBears.com

Community dining platform — Angular 19 + NestJS + MySQL on Docker/Unraid.

---

## Quick Start

### Prerequisites
- Docker Desktop (Windows/Mac) or Docker Engine (Linux/Unraid)
- Node.js 20+ (for local dev outside Docker)
- VS Code
- Git

### 1. Clone and configure environment
```bash
git clone <your-repo-url> dinnerbears
cd dinnerbears
cp .env.example .env
# Edit .env and fill in all values before proceeding
```

### 2. Start the stack
```bash
cd docker
docker compose up -d
```

Services started:
- Angular frontend → http://localhost (via NGINX)
- NestJS API → http://localhost/api/v1 (proxied by NGINX, no direct port)
- MySQL → internal only (no public port)

### 3. Check health
```bash
curl http://localhost/api/v1/health
# Should return: {"status":"ok"}
```

---

## Setting Up Claude Code in VS Code

Claude Code is Anthropic's AI coding assistant. It reads your `CLAUDE.md` files to
understand project conventions and gives more accurate, project-specific help.

### Step 1 — Install the VS Code extension
1. Open VS Code
2. Press `Ctrl+Shift+X` (Windows/Linux) or `Cmd+Shift+X` (Mac) to open Extensions
3. Search for **"Claude Code"**
4. Install the extension published by **Anthropic** (verified publisher, 2M+ installs)
5. The Claude Code panel icon (spark/lightning bolt) appears in the sidebar

### Step 2 — Authenticate
1. Click the Claude Code icon in the VS Code sidebar
2. Click **Sign In**
3. A browser window opens — log in with your Anthropic account
4. Return to VS Code — you are now authenticated
   - **Note:** Claude Code requires at minimum a **Claude Pro plan** ($20/month).
     The free tier does not include Claude Code access.

### Step 3 — Open the project
Open the `dinnerbears/` root folder in VS Code (not a subfolder).
Claude Code automatically reads `CLAUDE.md` from the project root.

### Step 4 — Install recommended extensions
When VS Code opens the project, a notification will appear:
> "This workspace has extension recommendations"

Click **Install All** to install the full set (Angular Language Service, ESLint,
Prettier, GitLens, Thunder Client, Docker, MySQL, and others).

Or install manually: `Ctrl+Shift+X` → filter by @recommended.

### Step 5 — Verify Claude Code sees the project context
In the Claude Code panel, start a new conversation and type:
```
What is this project and what phase are we in?
```
Claude should respond with details from CLAUDE.md — confirming it has read
the project context correctly.

---

## Using Claude Code Effectively

### The CLAUDE.md files
Three context files keep Claude accurate on this project:
- `CLAUDE.md` — root: full project overview, all conventions, security rules
- `frontend/CLAUDE.md` — Angular patterns, component structure, Material theme
- `api/CLAUDE.md` — NestJS patterns, module structure, security checklist

**Update `CLAUDE.md` "Current Development Phase" when starting a new phase.**

### Useful prompts for this project
```
# Generate a new NestJS module
Create a NestJS module called "cities" following the patterns in api/CLAUDE.md.
It should have an entity, DTO, service, and controller.

# Generate an Angular component
Create a standalone Angular component called "event-card" in features/events
using Angular Material MatCard, following the patterns in frontend/CLAUDE.md.

# Write tests
Write Jest unit tests for the RestaurantsService covering findAll() and create().

# Security review
Review this controller for security issues: missing guards, unvalidated input,
or TypeORM queries that could be vulnerable.

# Debug help
Here's the error from the Docker logs: [paste error]
What's causing this and how do I fix it?
```

### Project-level permissions
`.claude/settings.json` pre-approves safe commands (npm, ng, nest, docker, git)
so Claude doesn't prompt for permission on routine operations.

`.env` and secrets are explicitly denied in the settings — Claude cannot read them.

### Tips
- **Keep sessions focused** — one feature or one file at a time works best
- **Accept diffs and review** — use the inline diff view to accept/reject changes
- **Commit before big changes** — run `git add . && git commit -m "before Claude refactor"`
  before asking Claude to make large changes; easy to revert if needed
- **Use @filename references** — type `@frontend/src/app/core/services/auth.service.ts`
  in the chat to give Claude direct context on a specific file

---

## Development Workflow (Phase by Phase)

See `PHASES.md` for full phase breakdown. Current phase: **Phase 1 — Foundation**.

### Running locally (outside Docker)
```bash
# Frontend (Angular dev server with hot reload)
cd frontend
npm install
npm start
# → http://localhost:4200

# API (NestJS dev server with watch mode)
cd api
npm install
npm run start:dev
# → http://localhost:3000
```

### Running tests
```bash
# Frontend unit tests
cd frontend && npm test

# API unit tests
cd api && npm test

# API e2e tests
cd api && npm run test:e2e
```

### Database migrations
```bash
# Generate a migration after changing an entity
cd api && npm run migration:generate -- --name=AddCityTable

# Run pending migrations
cd api && npm run migration:run

# Revert last migration
cd api && npm run migration:revert
```

---

## Project Documentation

All specification documents are in `docs/`:
- `System_Spec_v1.0.docx` — Core system specification
- `Security_Addendum.docx` — Security architecture
- `Email_Notifications_Addendum.docx` — Email queue + web push
- `Dual_Email_Addendum.docx` — Brevo + Gmail overflow
- `UserSafety_SocialLogin_Addendum.docx` — Safety + OAuth
- `TechStack_PhasedDev_Addendum.docx` — This tech stack + 8-phase plan
- `Requirements_Register.docx` — Living requirements log (71 confirmed, 7 open)

---

## Environment Variables

See `.env.example` for all required variables with documentation.
Never commit `.env` — it is git-ignored.
