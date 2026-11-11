import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Invariants for the Unraid container templates in `docker/`.
 *
 * These are not code, but they are the only description of how a deployment is
 * configured, and every rule here comes from something that actually went
 * wrong rather than from tidiness.
 */
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

const TEMPLATES = {
  stage: 'communityevents-v2-stage-unraid.xml',
  prod: 'communityevents-v2-prod-unraid.xml',
} as const;

interface ConfigField {
  name: string;
  target: string;
  required: boolean;
  masked: boolean;
  display: string;
  value: string;
}

/** Every `<Config>` entry, which the templates write one per line. */
function fields(template: string): ConfigField[] {
  const xml = readFileSync(join(REPO_ROOT, 'docker', template), 'utf8');
  const attr = (tag: string, name: string) =>
    new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? '';

  return [...xml.matchAll(/<Config\b([^>]*)>([^<]*)</g)].map(([, tag, value]) => ({
    name: attr(tag, 'Name'),
    target: attr(tag, 'Target'),
    required: attr(tag, 'Required') === 'true',
    masked: attr(tag, 'Mask') === 'true',
    display: attr(tag, 'Display'),
    value: value.trim(),
  }));
}

describe.each(Object.entries(TEMPLATES))('%s Unraid template', (_env, template) => {
  // The one that bit Rob on the production template: a field that is both
  // Mask="true" and Required="true" renders as <input type="password" required>
  // and, when Display="advanced" hides it, the browser cannot focus it to show
  // the validation bubble. It then refuses to submit the form with no visible
  // error -- Apply simply does nothing. ("An invalid form control with
  // name='confValue[]' is not focusable.")
  //
  // It is also self-contradictory regardless of the browser: docs/SECRETS.md
  // says to leave masked fields EMPTY and put the value in the appdata .env,
  // because Unraid does not persist Mask="true" values at all.
  it('never marks a masked field required', () => {
    const offenders = fields(template)
      .filter((f) => f.masked && f.required)
      .map((f) => f.name);
    expect(offenders).toEqual([]);
  });

  // Same failure reached the other way: a required field with nothing in it
  // blocks Apply whether or not it is masked. Anything genuinely required must
  // therefore ship with a value the operator can accept as-is.
  it('gives every required field a non-empty value', () => {
    const empty = fields(template)
      .filter((f) => f.required && f.value === '')
      .map((f) => f.name);
    expect(empty).toEqual([]);
  });

  it('declares a Target and a Name for every field', () => {
    const malformed = fields(template).filter((f) => !f.name || !f.target);
    expect(malformed).toEqual([]);
  });
});

describe('stage and prod templates together', () => {
  // Drift between the two is what made writing the production template
  // dangerous: the stage template claimed database `communityevents` while the
  // live container had always used `communityevents_stage`, and
  // `communityevents` is production's. Re-adding stage from that template
  // would have pointed stage at production's data.
  it('never points both deployments at the same database', () => {
    const dbName = (template: string) =>
      fields(template).find((f) => f.target === 'DB_NAME')?.value;

    expect(dbName(TEMPLATES.stage)).toBeTruthy();
    expect(dbName(TEMPLATES.prod)).toBeTruthy();
    expect(dbName(TEMPLATES.stage)).not.toEqual(dbName(TEMPLATES.prod));
  });

  // IS_STAGE is the only thing distinguishing the two at runtime, since both
  // deliberately run NODE_ENV=production -- 'staging' would leave cookies
  // non-Secure and could leak stack traces. Getting it wrong puts a stage
  // banner on the live site, or removes it from stage.
  it('flags stage as stage and prod as not', () => {
    const isStage = (template: string) =>
      fields(template).find((f) => f.target === 'IS_STAGE')?.value;

    expect(isStage(TEMPLATES.stage)).toEqual('true');
    expect(isStage(TEMPLATES.prod)).toEqual('false');
  });

  // A variable added to one deployment and forgotten on the other is how the
  // two drift apart in the first place.
  it('offers the same variables on both', () => {
    const targets = (template: string) =>
      fields(template)
        .map((f) => f.target)
        .sort();

    expect(targets(TEMPLATES.prod)).toEqual(targets(TEMPLATES.stage));
  });
});
