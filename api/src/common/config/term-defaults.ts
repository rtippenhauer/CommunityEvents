/**
 * The generic terminology a community starts on.
 *
 * These live in `common/` rather than beside the rest of `SITE_SETTING_DEFAULTS`
 * because two callers outside the Nest application need them: `bootstrap.ts`
 * and, through it, the achievement catalogue seeded in v2-10. `bootstrap.ts`
 * is a plain node script that deliberately imports only from `common/` and
 * `database/` -- pulling in `app-config.service` would drag a Nest provider,
 * its decorators and its injected dependencies into a script that has no
 * container to resolve them from.
 *
 * `SITE_SETTING_DEFAULTS` imports these rather than restating them. Two
 * defaults that disagree is a failure this codebase has already had (see the
 * note on `brand_name` in `brand-config.service.ts`, where the settings form
 * and the API each held their own copy and the UI showed one name while the
 * app used another).
 */

export const DEFAULT_TERM_LOCATION_SINGULAR = 'Location';
export const DEFAULT_TERM_LOCATION_PLURAL = 'Locations';
export const DEFAULT_TERM_DINNER_SINGULAR = 'Event';
export const DEFAULT_TERM_DINNER_PLURAL = 'Events';
export const DEFAULT_TERM_POINTS = 'Points';
