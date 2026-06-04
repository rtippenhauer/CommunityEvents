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
Primary: #1E4D8C (DinnerBears blue)
Accent: #C9933A (gold)
Background: #FDFAF5 (warm white)

## Feature Structure
src/app/
├── core/               # Guards, interceptors, services (singleton)
├── shared/             # Reusable components and pipes
└── features/
    ├── auth/           # Login, registration, OAuth callbacks
    ├── profile/        # Member profile, settings, notifications
    ├── restaurants/    # Restaurant list and detail
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
Angular dev server runs on port 8080 (not 4200)
