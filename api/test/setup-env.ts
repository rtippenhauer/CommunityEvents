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
setDefault('SESSION_SECRET', 'test-session-secret-not-for-real-use');
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
