# DinnerBears — Fresh Start Installation Guide

## What's in this package

```
dinnerbears-fresh/
├── CLAUDE.md                     ← Claude Code project context
├── PHASES.md                     ← Development phases
├── README.md                     ← Project overview
├── README_INSTALL.md             ← This file
├── .env.example                  ← Copy to .env and fill in values
├── .gitignore
├── .claude/settings.json         ← Claude Code auto-approve settings
├── .vscode/                      ← VS Code settings + extensions
├── docs/
│   ├── REQUIREMENTS.md           ← 107 product requirements
│   ├── DATABASE_SCHEMA.md        ← 25 MySQL tables
│   └── FACEBOOK_APP_SETUP.md    ← Facebook OAuth guide
├── frontend/
│   ├── CLAUDE.md                 ← Angular conventions
│   ├── Dockerfile
│   └── public/                   ← Static placeholder site
│       ├── index.html            ← Landing page (deploy to dinnerbears.com)
│       ├── privacy.html          ← Privacy policy
│       └── terms.html            ← Terms of service
├── api/
│   ├── CLAUDE.md                 ← NestJS conventions
│   └── Dockerfile
└── docker/
    ├── docker-compose.yml        ← Full stack
    ├── nginx/nginx.conf          ← Subdomain routing + API proxy
    └── dinnerbears-unraid.xml    ← Unraid Community Applications template
```

## Setup Steps

### 1. Copy to your repo
Replace the contents of C:\Users\rtipp\source\repos\DinnerBears\ with these files.
Keep your existing .env file — do not overwrite it.

### 2. Install dependencies (run once)
```bash
cd frontend && npm install
cd ../api && npm install
```

### 3. Deploy placeholder site
Copy frontend/public/*.html to your web server so dinnerbears.com is live.
This satisfies Facebook's domain verification requirement.

### 4. Unraid setup
Import docker/dinnerbears-unraid.xml via Unraid Community Applications
to install the full stack with a GUI template.

### 5. Commit
```bash
git add .
git commit -m "Fresh start — updated scaffold, docs, and schema"
git push
```

### 6. Personal files (do not commit)
- DinnerBears_LLC_Operating_Agreement.docx — sign and keep for your records
