import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { ENV_CLASSIFICATION, envVarsIn } from './env-classification';
import { TENANT_SECRET_ENV_FALLBACK } from '../../modules/tenant-secrets/tenant-secret-keys';

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
    //
    // Raised from 11 to 14 by v2-7, for three variables that genuinely cannot
    // be anything else: SECRET_ENCRYPTION_KEY is what makes runtime config
    // readable, so storing it in runtime config is circular (and storing it in
    // the database would put the key in the same dump as the ciphertext);
    // SECRET_ENCRYPTION_KEYS_RETIRED is the same value one rotation ago; and
    // SECRET_ENCRYPTION_KEY_FILE says where to find the first of them.
    expect(envVarsIn('bootstrap').length).toBeLessThanOrEqual(14);
  });

  it('accounts for every credential', () => {
    // Named explicitly so the list has to be edited deliberately. Before v2-7
    // this guarded a stronger claim -- that no credential had left env, because
    // nowhere in the database could hold one safely. Now that ciphertext has a
    // home the list is a manifest rather than a fence: each of these has a note
    // saying whether it is per-community, per-deployment, or waiting on the
    // item that populates its real column.
    //
    // v2-8 removed four rather than moving them: the two Google and two
    // Facebook variables have no deployment-wide meaning left, because a
    // community without its own app offers email/password rather than falling
    // back to the platform's (REQ-TENANT-01.9).
    expect(envVarsIn('secret')).toEqual([
      'ANTHROPIC_API_KEY',
      'BREVO_API_KEY',
      'BREVO_WEBHOOK_SECRET',
      'CLAUDE_AUTOMATION_SECRET',
      'CLOUDFLARE_EMAIL_SECRET',
      'GEOCODING_API_KEY',
      'GMAIL_APP_PASSWORD',
      'GMAIL_USER',
      'GOOGLE_PLACES_API_KEY',
      'RESEND_API_KEY',
      'VAPID_PRIVATE_KEY',
    ]);
  });

  // The three secrets that became per-community in v2-7 are named in two
  // places: here, and as the env fallbacks in tenant-secret-keys.ts. They have
  // to agree, or a community setting its own key would override a variable the
  // code never reads.
  it('agrees with tenant-secret-keys.ts about which secrets are per-community', () => {
    for (const envVar of Object.values(TENANT_SECRET_ENV_FALLBACK)) {
      expect(ENV_CLASSIFICATION[envVar]?.cls).toBe('secret');
    }
  });

  it('never classifies a secret as runtime config', () => {
    const looksLikeSecret = /(_SECRET|_API_KEY|_PASSWORD|PRIVATE_KEY)$/;
    const leaked = envVarsIn('runtime').filter((name) => looksLikeSecret.test(name));
    expect(leaked).toEqual([]);
  });
});
