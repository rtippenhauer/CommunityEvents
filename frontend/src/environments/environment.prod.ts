// Production build flag only. All per-instance values are runtime (served from
// each instance's .env via /config/branding) — see environment.ts. This one
// production build serves every instance and both stage and prod (the stage
// banner is driven by the runtime IS_STAGE flag, not a separate build).
export const environment = {
  production: true,
  apiUrl: '/api/v1',
};
