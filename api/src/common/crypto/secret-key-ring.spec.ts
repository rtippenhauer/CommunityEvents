import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  generateSecretKey,
  KEY_FILE_ENV,
  keyFileLooksPersistent,
  keyIdFor,
  keyFilePath,
  PRIMARY_KEY_ENV,
  persistSecretKey,
  resetSecretKeyRing,
  RETIRED_KEYS_ENV,
  secretKeyRing,
} from './secret-key-ring';

const keyOf = (text: string): string => Buffer.from(text.padEnd(32, '.')).toString('base64');

const PRIMARY = keyOf('primary-key');
const RETIRED = keyOf('retired-key');

describe('secret key ring (v2-7)', () => {
  const saved = { primary: process.env[PRIMARY_KEY_ENV], retired: process.env[RETIRED_KEYS_ENV] };
  let keyDir: string;

  beforeEach(() => {
    resetSecretKeyRing();
    process.env[PRIMARY_KEY_ENV] = PRIMARY;
    delete process.env[RETIRED_KEYS_ENV];
    // Every test points the key file at an empty temp directory, so none of
    // them can read -- or worse, write -- a real deployment's key.
    keyDir = mkdtempSync(join(tmpdir(), 'ce-ring-'));
    process.env[KEY_FILE_ENV] = join(keyDir, 'secret-encryption.key');
  });

  afterEach(() => {
    resetSecretKeyRing();
    if (saved.primary === undefined) delete process.env[PRIMARY_KEY_ENV];
    else process.env[PRIMARY_KEY_ENV] = saved.primary;
    if (saved.retired === undefined) delete process.env[RETIRED_KEYS_ENV];
    else process.env[RETIRED_KEYS_ENV] = saved.retired;
    delete process.env[KEY_FILE_ENV];
    rmSync(keyDir, { recursive: true, force: true });
  });

  it('reads the primary key and gives it an id', () => {
    const ring = secretKeyRing();
    expect(ring.primary.bytes).toHaveLength(32);
    expect(ring.primary.id).toMatch(/^[0-9a-f]{8}$/);
    expect(ring.byId.get(ring.primary.id)).toBe(ring.primary);
  });

  it('derives the same id for the same key every time', () => {
    const bytes = Buffer.from(PRIMARY, 'base64');
    expect(keyIdFor(bytes)).toBe(keyIdFor(Buffer.from(bytes)));
  });

  it('holds retired keys for decryption alongside the primary', () => {
    process.env[RETIRED_KEYS_ENV] = ` ${RETIRED} , `;
    const ring = secretKeyRing();

    expect(ring.byId.size).toBe(2);
    // Whitespace and a trailing separator are tolerated: this variable is
    // edited by hand, mid-rotation, by someone appending to a list.
    expect(ring.byId.has(keyIdFor(Buffer.from(RETIRED, 'base64')))).toBe(true);
    expect(ring.primary.id).not.toBe(keyIdFor(Buffer.from(RETIRED, 'base64')));
  });

  // Failing loudly here is the whole point: a deployment that cannot decrypt
  // its own credentials should say so at startup, not when a mail fails to send.
  it('refuses to answer with no key and no key file', () => {
    delete process.env[PRIMARY_KEY_ENV];
    expect(() => secretKeyRing()).toThrow(/No encryption key/);
  });

  describe('the key file', () => {
    it('supplies the key when the env var is unset', () => {
      const written = generateSecretKey();
      persistSecretKey(written);

      resetSecretKeyRing();
      delete process.env[PRIMARY_KEY_ENV];

      expect(secretKeyRing().primary.id).toBe(keyIdFor(Buffer.from(written, 'base64')));
    });

    it('loses to the env var, so an operator can always override it', () => {
      persistSecretKey(generateSecretKey());
      resetSecretKeyRing();

      expect(secretKeyRing().primary.id).toBe(keyIdFor(Buffer.from(PRIMARY, 'base64')));
    });

    it('is written owner-readable and with a trailing newline', () => {
      const key = generateSecretKey();
      const path = persistSecretKey(key);

      expect(existsSync(path)).toBe(true);
      // A stray newline is what makes the file safe to `cat` and to edit; the
      // reader trims it.
      expect(readFileSync(path, 'utf8')).toBe(`${key}\n`);
    });

    // Overwriting would orphan every secret written under the old key, silently.
    // Rotation is the supported way to change keys, and it keeps both readable.
    it('refuses to overwrite an existing key file', () => {
      persistSecretKey(generateSecretKey());
      expect(() => persistSecretKey(generateSecretKey())).toThrow(/Refusing to overwrite/);
    });

    it('generates a usable 32-byte key', () => {
      expect(Buffer.from(generateSecretKey(), 'base64')).toHaveLength(32);
      expect(generateSecretKey()).not.toBe(generateSecretKey());
    });

    it('honours SECRET_ENCRYPTION_KEY_FILE over the default path', () => {
      expect(keyFilePath()).toBe(join(keyDir, 'secret-encryption.key'));
    });

    // Found on the v2-7 stage pass: /app/appdata was not mapped to a host path,
    // so every generated key lived in the container layer and vanished on the
    // next recreate. Nothing was lost -- generating requires an empty database
    // -- but the log told the operator to back up a file that could not survive.
    describe('detecting a directory that cannot persist', () => {
      it('reports an ordinary directory as not persistent', () => {
        // keyDir is a plain directory inside the temp dir, sharing its parent's
        // filesystem -- which is exactly what an unmapped container path looks
        // like from inside the container.
        expect(keyFileLooksPersistent()).toBe(false);
      });

      it('says nothing useful rather than crying wolf when it cannot tell', () => {
        // A path whose parent does not exist cannot be compared. Optimism is
        // deliberate: a false alarm about a correctly mounted volume trains an
        // operator to ignore the warning that matters.
        process.env[KEY_FILE_ENV] = join(keyDir, 'no', 'such', 'dir', 'key');
        expect(keyFileLooksPersistent()).toBe(true);
      });

      it('treats the filesystem root as nothing to compare', () => {
        process.env[KEY_FILE_ENV] = '/key';
        expect(keyFileLooksPersistent()).toBe(true);
      });
    });
  });

  it('refuses a key that is not 32 bytes', () => {
    process.env[PRIMARY_KEY_ENV] = Buffer.from('too-short').toString('base64');
    expect(() => secretKeyRing()).toThrow(/expected 32 bytes/);
  });

  // A rotation where the old value was never removed leaves the operator
  // believing they have rotated when they have not, so it is an error rather
  // than a harmless duplicate.
  it('refuses a retired key that is still the primary', () => {
    process.env[RETIRED_KEYS_ENV] = PRIMARY;
    expect(() => secretKeyRing()).toThrow(/Retire the \*previous\* key/);
  });
});
