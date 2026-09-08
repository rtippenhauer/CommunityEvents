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
properties in `src/styles.scss` — always reference `var(--ce-*)` in component styles, never a
bare hex literal. The `styles.scss` literals are the pre-JS paint only; every one is overwritten
at runtime.

**Tokens are named for their job, never for the colour they hold (v2-11).** They were `--db-*`
(DinnerBears) with names like `--db-brown-nav` and `--db-cream`, which stayed brown and cream in
the source while holding whatever colour a community had chosen — so the source lied to whoever
read it next. Three seeds an admin configures (`--ce-primary`, `--ce-accent`, `--ce-surface`) feed
everything else: `--ce-primary-hover`, `--ce-surface-variant`, the chrome family (`--ce-chrome`,
`-deep`, `-raised`, `-soft`), `--ce-banner`, the ink (`--ce-text`, `--ce-text-muted`,
`--ce-on-chrome-muted`, `--ce-accent-on-chrome`), and the `--ce-on-*` pair for each. `--ce-success`
and `--ce-error-overlay` are platform-fixed — red means error, which is not a branding choice.

The three seeds (plus app name/tagline) are admin-editable. Name and tagline live in
`/admin/settings`; the colours moved to their own screen at `/admin/appearance` in v2-11 —
presets, seeds, per-token overrides, a scoped live preview, the copyable LLM prompt with its
paste-back importer, and contrast warnings that warn without blocking. Only that screen writes
`theme_color_*` and `theme_palette_overrides`, so there is one place the palette can change from.
Both override the CSS variables at runtime through `BrandConfigService`
(see `core/services/brand-config.service.ts`) — the `styles.scss` values are just the
compiled-in default a fresh fork starts with. Note that `index.html`'s `theme-color` meta tag
and `public/manifest.webmanifest` are static, pre-Angular-bootstrap files with no CSS-variable
indirection — they don't pick up an admin-configured color change without a manual edit + rebuild.

Angular Material components are wired into this too: `styles.scss` uses `mat.theme($theme-config)`
(not `mat.all-component-themes()` — that mixin bakes literal computed colors into each component's
tokens, which shadow runtime overrides) so Material emits its `--mat-sys-*` system tokens instead,
which its own M3 component styles already fall back to. `BrandConfigService` sets `--mat-sys-primary`/
`--mat-sys-tertiary` (Material's M2→M3 compat layer maps `color="accent"` to tertiary, not
secondary) alongside the `--ce-*` tokens, so `color="primary"`/`color="accent"` Material components
(buttons, toggles, checkboxes, form-field focus states) follow admin branding too.

**Every `on-` colour is measured, not assumed (v2-11).** `onColorFor` in `core/utils/color.util.ts`
picks whichever of white or black has the higher WCAG contrast against the colour it sits on, and
`--ce-on-primary` / `--ce-on-accent` / `--ce-on-chrome` / `--ce-on-banner` carry the result. This
used to be pinned to white, which failed on the seeded amber itself: white on `#C9933A` measures
2.72:1, below AA's 4.5. **Never write a literal `#fff` as text on a `var(--ce-*)` background** —
use the matching `--ce-on-*` token, or the community that picks a pale primary gets the same defect
back one component at a time. The same goes for surfaces: a literal hex as a *background* is a
colour belonging to no community. `theme_color_accent` is the per-tenant setting that means "our
second colour" and is what a two-colour surface should blend toward — it defaults to the primary,
so a community that has not chosen one gets a flat surface in its own colour rather than a
stranger's. For a surface painted with both, `--ce-on-brand-blend` is the label colour, measured
against *both* stops via `onColorForAll`: a label is unreadable wherever it is worst, not on
average.

`ON_LIGHT` is pure black on purpose, against the usual advice: swept across the whole HSL cube the
worst achievable contrast is 4.584:1 with `#000000` and 4.173:1 with a softened `#1a1a1a`, so black
is the only choice that clears AA for *every* colour an admin can pick. Body copy still gets a warm
brand-tinted ink via `readableOn`, which prefers a tone and falls back to the measured floor only
when that tone fails.

Hover and derived shades (the dark chrome family, button hover states, the nav sidebar, the ink
tones) *are* generated from the three configured colours — `core/utils/palette.ts` derives them by
absolute lightness target, so a different hue yields the equivalent tones in that hue. That module
is pure and DOM-free, which is what lets the admin screen preview a palette without repainting the
running app; `BrandConfigService` only writes what it returns.

**A dark page background is NOT supported, and the screen says so.** The derivation handles one
correctly — the ink flips to near-white and every ratio passes — but the app cannot draw it:
`styles.scss` compiles `theme-type: light`, nothing overrides Angular Material's `--mat-sys-surface`
family, and 27 components hardcode a light background across 145 declarations. The result is
white body copy on cream cards. `contrastWarnings` therefore emits a warning with
`kind: 'unsupported'` whenever white wins as the on-colour for `--ce-surface`, and the prompt asks
for a light background rather than "very light or very dark" — the earlier wording steered a model
straight into the one state the app cannot render. Supporting dark properly means the Material
surface tokens plus those 145 sites, which is its own piece of work.

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
