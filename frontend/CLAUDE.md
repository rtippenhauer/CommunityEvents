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
The `styles.scss` literals are the pre-JS paint only; every one is overwritten at runtime.

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
(buttons, toggles, checkboxes, form-field focus states) follow admin branding too.

**Every `on-` colour is measured, not assumed (v2-11).** `onColorFor` in `core/utils/color.util.ts`
picks whichever of white or black has the higher WCAG contrast against the colour it sits on, and
`--db-on-primary` / `--db-on-accent` / `--db-on-chrome` / `--db-on-banner` carry the result. This
used to be pinned to white, which failed on the seeded amber itself: white on `#C9933A` measures
2.72:1, below AA's 4.5. **Never write a literal `#fff` as text on a `var(--db-*)` background** —
use the matching `--db-on-*` token, or the community that picks a pale primary gets the same defect
back one component at a time.

`ON_LIGHT` is pure black on purpose, against the usual advice: swept across the whole HSL cube the
worst achievable contrast is 4.584:1 with `#000000` and 4.173:1 with a softened `#1a1a1a`, so black
is the only choice that clears AA for *every* colour an admin can pick. Body copy still gets a warm
brand-tinted ink via `readableOn`, which prefers a tone and falls back to the measured floor only
when that tone fails.

Hover and derived shades (the dark chrome family, button hover states, the nav sidebar, the ink
tones) *are* generated from the three configured colours — `BrandConfigService.applyChrome` derives
them by absolute lightness target, so a different hue yields the equivalent tones in that hue.

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
