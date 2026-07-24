# DinnerBears Frontend — Angular 19

## Conventions (STRICT — always follow these)
- Standalone components only — never NgModules
- Reactive Forms only — never template-driven forms
- Angular Signals for local state
- Functional route guards (CanActivateFn)
- Lazy-loaded feature routes
- Angular Material for all UI components
- SCSS with CSS variables for theming

## Theme
Primary/Accent: #C9933A (amber gold) — Background: #FDFAF5 (warm white). Defined as CSS custom
properties in `src/styles.scss` (`--db-primary`, `--db-accent`, `--db-cream`, plus derived
shades) — always reference `var(--db-*)` in component styles, never a bare hex literal.

As of Phase 29 these three core colors (plus app name/tagline) are also admin-editable via
`/admin/settings`, which overrides the CSS variables at runtime through `BrandConfigService`
(see `core/services/brand-config.service.ts`) — the `styles.scss` values are just the
compiled-in default a fresh fork starts with. Note that `index.html`'s `theme-color` meta tag
and `public/manifest.webmanifest` are static, pre-Angular-bootstrap files with no CSS-variable
indirection — they don't pick up an admin-configured color change without a manual edit + rebuild.

Angular Material components are wired into this too: `styles.scss` uses `mat.theme($theme-config)`
(not `mat.all-component-themes()` — that mixin bakes literal computed colors into each component's
tokens, which shadow runtime overrides) so Material emits its `--mat-sys-*` system tokens instead,
which its own M3 component styles already fall back to. `BrandConfigService` sets `--mat-sys-primary`/
`--mat-sys-tertiary` (Material's M2→M3 compat layer maps `color="accent"` to tertiary, not
secondary) alongside the `--db-*` vars, so `color="primary"`/`color="accent"` Material components
(buttons, toggles, checkboxes, form-field focus states) follow admin branding too. `on-primary`/
`on-tertiary` text color is hardcoded to white rather than contrast-computed — a very light admin-
chosen color will read poorly until that's built. Hover/derived shades (button hover states, nav
sidebar) also aren't auto-generated from the 3 configured colors — a very different hue may look
slightly off there.

## Feature Structure
src/app/
├── core/               # Guards, interceptors, services (singleton)
├── shared/             # Reusable components and pipes
└── features/
    ├── auth/           # Login, registration, OAuth callbacks
    ├── profile/        # Member profile, settings, notifications
    ├── locations/      # Location list and detail (displayed as "Restaurant" in the UI)
    ├── events/         # Event list, detail, RSVP
    ├── announcements/  # Community announcements
    ├── admin/          # Admin panel (lazy, role-gated)
    └── notifications/  # Bell component, notification list

## API Communication
- All HTTP via typed services in core/services/
- AuthInterceptor adds JWT cookie automatically
- Never call HttpClient directly in components
- All API responses typed with interfaces

## Port
Angular dev server runs on port 4200 (ng serve default — not overridden)
