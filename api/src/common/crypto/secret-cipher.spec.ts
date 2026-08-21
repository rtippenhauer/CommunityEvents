import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  isUnderPrimaryKey,
  SecretDecryptError,
  secretKeyIdOf,
  type SecretContext,
} from './secret-cipher';
import { PRIMARY_KEY_ENV, RETIRED_KEYS_ENV, resetSecretKeyRing } from './secret-key-ring';

const keyOf = (text: string): string => Buffer.from(text.padEnd(32, '.')).toString('base64');

const KEY_A = keyOf('key-a');
const KEY_B = keyOf('key-b');

const COLUMN: SecretContext = { model: 'email_provider_config', field: 'brevoApiKey' };
const OTHER_COLUMN: SecretContext = { model: 'tenants', field: 'googleClientSecret' };

/** Puts a specific key in place and clears the cached ring around it. */
function useKeys(primary: string, retired?: string): void {
  resetSecretKeyRing();
  process.env[PRIMARY_KEY_ENV] = primary;
  if (retired) process.env[RETIRED_KEYS_ENV] = retired;
  else delete process.env[RETIRED_KEYS_ENV];
}

describe('secret cipher (v2-7)', () => {
  const saved = { primary: process.env[PRIMARY_KEY_ENV], retired: process.env[RETIRED_KEYS_ENV] };

  beforeEach(() => useKeys(KEY_A));

  afterEach(() => {
    resetSecretKeyRing();
    if (saved.primary === undefined) delete process.env[PRIMARY_KEY_ENV];
    else process.env[PRIMARY_KEY_ENV] = saved.primary;
    if (saved.retired === undefined) delete process.env[RETIRED_KEYS_ENV];
    else process.env[RETIRED_KEYS_ENV] = saved.retired;
  });

  it('round-trips a value', () => {
    const stored = encryptSecret('xkeysib-not-a-real-key', COLUMN);
    expect(decryptSecret(stored, COLUMN)).toBe('xkeysib-not-a-real-key');
  });

  it('stores something that does not contain the plaintext', () => {
    const stored = encryptSecret('xkeysib-not-a-real-key', COLUMN);
    expect(stored).not.toContain('xkeysib');
    expect(isEncryptedSecret(stored)).toBe(true);
  });

  // The property that makes an encrypted column unfilterable, asserted so that
  // nobody "fixes" it into a deterministic cipher to make a query work.
  it('encrypts the same value differently every time', () => {
    expect(encryptSecret('same', COLUMN)).not.toBe(encryptSecret('same', COLUMN));
  });

  it('leaves null, undefined and empty alone', () => {
    // An unset secret is a meaningful state; encrypting '' would make it read
    // as configured.
    expect(encryptSecret(null, COLUMN)).toBeNull();
    expect(encryptSecret(undefined, COLUMN)).toBeUndefined();
    expect(encryptSecret('', COLUMN)).toBe('');
    expect(decryptSecret(null, COLUMN)).toBeNull();
  });

  it('names the key that wrote it', () => {
    const stored = encryptSecret('value', COLUMN);
    expect(secretKeyIdOf(stored)).toMatch(/^[0-9a-f]{8}$/);
    expect(isUnderPrimaryKey(stored)).toBe(true);

    useKeys(KEY_B, KEY_A);
    // Same ciphertext, different primary: still readable, no longer current.
    expect(isUnderPrimaryKey(stored)).toBe(false);
    expect(decryptSecret(stored, COLUMN)).toBe('value');
  });

  it('cannot read a value written under a key it no longer holds', () => {
    const stored = encryptSecret('value', COLUMN);
    useKeys(KEY_B);
    expect(() => decryptSecret(stored, COLUMN)).toThrow(SecretDecryptError);
    expect(() => decryptSecret(stored, COLUMN)).toThrow(/SECRET_ENCRYPTION_KEYS_RETIRED/);
  });

  // The AAD binding. Someone with write access to the database cannot move a
  // ciphertext between columns and have it decrypt there.
  it('refuses a value moved to a different column', () => {
    const stored = encryptSecret('value', COLUMN);
    expect(() => decryptSecret(stored, OTHER_COLUMN)).toThrow(/Failed to authenticate/);
  });

  it('refuses a value that has been altered', () => {
    const stored = encryptSecret('value', COLUMN);
    const [, , keyId, payload] = stored.split(':');
    const bytes = Buffer.from(payload, 'base64');
    bytes[bytes.length - 1] ^= 0xff;
    const tampered = `enc:v1:${keyId}:${bytes.toString('base64')}`;

    expect(() => decryptSecret(tampered, COLUMN)).toThrow(/Failed to authenticate/);
  });

  it('rejects a malformed envelope rather than guessing', () => {
    expect(() => decryptSecret('enc:v1:deadbeef', COLUMN)).toThrow(/Malformed secret envelope/);

    // A real key id, so this reaches the length check rather than stopping at
    // "no such key" -- the two failures are distinct and both want their own
    // message.
    const keyId = secretKeyIdOf(encryptSecret('anything', COLUMN));
    expect(() => decryptSecret(`enc:v1:${keyId}:c2hvcnQ=`, COLUMN)).toThrow(/Truncated/);
  });

  // The migration tolerance. Deploying encryption onto a database that already
  // holds plaintext must not break it -- but it must say so.
  describe('legacy plaintext', () => {
    it('passes a bare value through unchanged', () => {
      expect(decryptSecret('plain-old-api-key', COLUMN)).toBe('plain-old-api-key');
    });

    it('reports it to the caller so it can be logged', () => {
      const onLegacy = vi.fn();
      decryptSecret('plain-old-api-key', COLUMN, onLegacy);
      expect(onLegacy).toHaveBeenCalledWith(COLUMN);
    });

    it('says nothing for a properly encrypted value', () => {
      const onLegacy = vi.fn();
      decryptSecret(encryptSecret('value', COLUMN), COLUMN, onLegacy);
      expect(onLegacy).not.toHaveBeenCalled();
    });
  });
});
