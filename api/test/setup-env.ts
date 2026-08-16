import { setTestTenantFallback } from '../src/common/tenant/tenant-store';
// Runs before the e2e Nest app boots (see vitest.config.e2e.ts "setupFiles").
// Values are dummy/local-only — this app never talks to real Google/Facebook/
// email providers in tests, these just satisfy configService.getOrThrow()
// calls made at module-construction time. Only set if not already present,
// so CI can override any of these via real env vars if needed.
import * as path from 'node:path';

// process.cwd() rather than __dirname: both runners start in api/, and
// __dirname does not exist in an ES module, which is how Vitest loads this.
const TEST_DIR = path.join(process.cwd(), 'test');

function setDefault(key: string, value: string): void {
  if (!process.env[key]) process.env[key] = value;
}

setDefault('NODE_ENV', 'test');
setDefault('DB_HOST', '127.0.0.1');
setDefault('DB_PORT', '3307');
setDefault('DB_USER', 'root');
setDefault('DB_PASSWORD', 'test');
setDefault('DB_NAME', 'dinnerbears_test');
setDefault('JWT_SECRET', 'test-jwt-secret-not-for-real-use');
setDefault('GOOGLE_CLIENT_ID', 'test-google-client-id');
setDefault('GOOGLE_CLIENT_SECRET', 'test-google-client-secret');
setDefault('APP_URL', 'http://localhost:8081');
setDefault('BASE_DOMAIN', 'localhost');
setDefault('UPLOAD_PATH', '/tmp/dinnerbears-test-uploads');
setDefault('FACEBOOK_APP_SECRET', 'test-facebook-app-secret-not-for-real-use');
setDefault('CLAUDE_AUTOMATION_SECRET', 'test-automation-secret-not-for-real-use');
setDefault('CLOUDFLARE_EMAIL_SECRET', 'test-cloudflare-email-secret-not-for-real-use');
setDefault('BREVO_WEBHOOK_SECRET', 'test-brevo-webhook-secret-not-for-real-use');
setDefault('RELEASE_NOTES_DIR', path.join(TEST_DIR, 'fixtures', 'release-notes'));

/**
 * The tenant every spec's fixtures and requests belong to.
 *
 * Pinned rather than auto-incremented because TenantResolutionService caches
 * resolutions for a few seconds across a truncation — see seedRequestTenant.
 */
export const TEST_TENANT_ID = 1;

/**
 * Establishes a tenant context for the worker itself, before any spec runs.
 *
 * From v2-5 the Prisma extension refuses to touch a tenant-scoped model with no
 * tenant in context. Requests get one from TenantMiddleware, but the ~56 places
 * where specs seed fixtures by calling Prisma directly do not go through HTTP at
 * all, and would otherwise every one of them throw. Setting it once here is the
 * alternative to wrapping fixture setup in runWithTenant across 28 spec files.
 *
 * A module-level fallback rather than AsyncLocalStorage because Vitest runs each
 * hook and each test body in a sibling async context: a store entered here, or
 * in a beforeEach, is simply not visible inside the it() that follows. Request
 * handling still opens its own real ALS scope via runWithTenant, which takes
 * precedence, so this does not weaken what the specs are testing.
 */
setTestTenantFallback(TEST_TENANT_ID);
