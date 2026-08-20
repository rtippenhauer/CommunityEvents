import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { ENV_CLASSIFICATION, envVarsIn } from './env-classification';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

function readRepoFile(...parts: string[]): string {
  return readFileSync(join(REPO_ROOT, ...parts), 'utf8');
}

/** Variable names assigned in .env.example, ignoring commented-out lines. */
function envExampleVars(): string[] {
  return readRepoFile('.env.example')
    .split('\n')
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1])
    .filter((name): name is string => !!name);
}

describe('env classification (REQ-TENANT-01.4)', () => {
  // The point of the manifest: adding a variable to the sample env without
  // deciding whether it is bootstrap or runtime config should fail, the same
  // way an unclassified Prisma model fails tenant-scoped-models.ts.
  it('classifies every variable in .env.example', () => {
    const unclassified = envExampleVars().filter((name) => !(name in ENV_CLASSIFICATION));
    expect(unclassified).toEqual([]);
  });

  // The other direction: a classification that outlives the variable it
  // describes is worse than no classification, because it reads as current.
  it('has no classification for a variable nothing mentions', () => {
    const haystack = [
      readRepoFile('.env.example'),
      readRepoFile('docs', 'NEW_INSTANCE_SETUP.md'),
      readRepoFile('docker', 'communityevents-v2-stage-unraid.xml'),
      readRepoFile('docker', 'docker-compose.yml'),
    ].join('\n');

    // Whole tokens, not substrings: a plain `includes` would count
    // ROOT_TENANT_SLUG as documenting TENANT_SLUG, and API_PORT as documenting
    // PORT, which is how an undocumented variable hides behind a longer one.
    const documented = new Set(haystack.match(/[A-Z][A-Z0-9_]*/g) ?? []);
    const orphaned = Object.keys(ENV_CLASSIFICATION).filter((name) => !documented.has(name));
    expect(orphaned).toEqual([]);
  });

  it('keeps bootstrap config small', () => {
    // REQ-TENANT-01.4 asks for "minimal by design". This is not a style rule --
    // every name here is a value an operator must get right before the app can
    // tell them anything at all, since it is read before the database or the
    // tenant registry is reachable. If this assertion starts failing, the
    // question to ask is whether the new variable could have been runtime
    // config, not whether to raise the number.
    expect(envVarsIn('bootstrap').length).toBeLessThanOrEqual(11);
  });

  it('leaves every credential in env until v2-7 can encrypt it', () => {
    // Guards the actual risk in this split: a well-meaning change that moves an
    // API key into app_config, which has no encryption at rest. Named
    // explicitly so the list has to be edited deliberately.
    expect(envVarsIn('secret-pending-v2-7')).toEqual([
      'ANTHROPIC_API_KEY',
      'BREVO_API_KEY',
      'BREVO_WEBHOOK_SECRET',
      'CLAUDE_AUTOMATION_SECRET',
      'CLOUDFLARE_EMAIL_SECRET',
      'FACEBOOK_APP_ID',
      'FACEBOOK_APP_SECRET',
      'GEOCODING_API_KEY',
      'GMAIL_APP_PASSWORD',
      'GMAIL_USER',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'GOOGLE_PLACES_API_KEY',
      'RESEND_API_KEY',
      'VAPID_PRIVATE_KEY',
    ]);
  });

  it('never classifies a secret as runtime config', () => {
    const looksLikeSecret = /(_SECRET|_API_KEY|_PASSWORD|PRIVATE_KEY)$/;
    const leaked = envVarsIn('runtime').filter((name) => looksLikeSecret.test(name));
    expect(leaked).toEqual([]);
  });
});
