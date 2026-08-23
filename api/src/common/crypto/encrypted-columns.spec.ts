import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { allEncryptedColumns, encryptedFieldsOf, hasEncryptedColumns } from './encrypted-columns';

/**
 * String columns that look like secrets and are deliberately not encrypted.
 *
 * This is the other half of ENCRYPTED_COLUMNS. That list says what is
 * protected; without this one, nothing would notice a future
 * `stripe_api_key` column being added and never registered — it would simply
 * store a working credential in plaintext, which is not a failure anything
 * observes.
 *
 * Every entry needs a reason, and the reasons fall into two groups: values that
 * are already one-way (a hash gains nothing from being encrypted), and
 * single-use random tokens that are compared against what a link carries rather
 * than being credentials we present to anyone.
 */
const NOT_A_STORED_SECRET: Readonly<Record<string, string>> = {
  'tenant_secrets.secretKey':
    'The name of the setting, not its value. It has to be filterable, which is ' +
    'exactly what an encrypted column cannot be.',
  'users.passwordHash':
    'bcrypt, and must stay that way. Encrypting a hash would let whoever holds ' +
    'the key recover... a hash.',
  'users.emailVerificationToken':
    'Single-use random token, compared against the one in a link. Nothing ' +
    'presents it to a third party, so there is no plaintext worth protecting.',
  'users.passwordResetToken': 'As emailVerificationToken.',
  'users.calendarToken':
    'A capability in a URL the member subscribes to from their calendar app. It ' +
    'is looked up by value on every fetch, which an encrypted column cannot do.',
  'invites.token': 'As emailVerificationToken, and looked up by value.',
  'event_guest_links.token': 'As invites.token.',
  'events.reservationConfirmToken': 'As invites.token.',
};

/** Names that suggest a credential, whatever the column turns out to hold. */
const LOOKS_LIKE_A_SECRET = /secret|api_?key|password|token|private_?key|credential/i;

describe('encrypted columns (v2-7)', () => {
  it('resolves the declared columns and nothing else', () => {
    expect(encryptedFieldsOf('email_provider_config')).toEqual([
      'brevoApiKey',
      'resendApiKey',
      'webhookSecret',
    ]);
    expect(hasEncryptedColumns('users')).toBe(false);
    expect(encryptedFieldsOf(undefined)).toBeUndefined();
  });

  it('names a real model and a real field for every entry', () => {
    // The map is type-checked against the generated client, so this only fails
    // if the schema is regenerated without the map being updated -- which is
    // the case where the type error appears somewhere else entirely.
    const fieldsOf = new Map(
      Prisma.dmmf.datamodel.models.map((model) => [
        model.name,
        new Set(model.fields.map((field) => field.name)),
      ]),
    );

    for (const { model, field } of allEncryptedColumns()) {
      expect(fieldsOf.get(model), `unknown model ${model}`).toBeDefined();
      expect(fieldsOf.get(model)?.has(field), `unknown field ${model}.${field}`).toBe(true);
    }
  });

  // The build-time guard this file exists for. A new column whose name suggests
  // a credential has to be either encrypted or waived above with a reason --
  // the same shape as env-classification.ts, and for the same reason: the
  // failure mode of forgetting is silent.
  it('accounts for every string column that looks like a secret', () => {
    const encrypted = new Set(
      allEncryptedColumns().map(({ model, field }) => `${model}.${field}`),
    );

    const unaccounted: string[] = [];
    for (const model of Prisma.dmmf.datamodel.models) {
      for (const field of model.fields) {
        // String-typed scalars only. A boolean called `is_secret` or an int
        // called `tmpl_password_reset` cannot hold a credential.
        if (field.kind !== 'scalar' || field.type !== 'String') continue;
        if (!LOOKS_LIKE_A_SECRET.test(field.dbName ?? field.name)) continue;

        const column = `${model.name}.${field.name}`;
        if (encrypted.has(column) || column in NOT_A_STORED_SECRET) continue;
        unaccounted.push(column);
      }
    }

    expect(unaccounted).toEqual([]);
  });

  it('has no waiver for a column that no longer exists', () => {
    // A waiver that outlives its column reads as a considered decision about
    // something that is not there any more.
    const columns = new Set(
      Prisma.dmmf.datamodel.models.flatMap((model) =>
        model.fields.map((field) => `${model.name}.${field.name}`),
      ),
    );

    const orphaned = Object.keys(NOT_A_STORED_SECRET).filter((column) => !columns.has(column));
    expect(orphaned).toEqual([]);
  });
});
