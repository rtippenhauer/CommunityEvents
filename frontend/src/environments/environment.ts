// Per-instance values (brand, colors, VAPID public key, Facebook app id, stage
// flag, canonical URL, cookie base domain) are NO LONGER compiled in here —
// they are served at runtime from each instance's own .env via
// /config/branding and read through BrandConfigService, so one generic image
// serves any instance. Only the build-time production flag and the API prefix
// remain. See docs/NEW_INSTANCE_SETUP.md.
export const environment = {
  production: false,
  apiUrl: '/api/v1',
};
