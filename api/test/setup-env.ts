// Runs before the e2e Nest app boots (see test/jest-e2e.json "setupFiles").
// Values are dummy/local-only — this app never talks to real Google/Facebook/
// email providers in tests, these just satisfy configService.getOrThrow()
// calls made at module-construction time. Only set if not already present,
// so CI can override any of these via real env vars if needed.
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
