import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { secretKeyRing, type SecretKey } from './secret-key-ring';

/**
 * Envelope encryption for secrets stored in the database (v2-7).
 *
 * AES-256-GCM: authenticated, so a ciphertext that has been altered fails to
 * decrypt rather than yielding garbage that then gets sent to Brevo as an API
 * key. A fresh random 96-bit IV per encryption, which also means the same
 * plaintext encrypts differently every time — deliberate, and the reason an
 * encrypted column can never be filtered, ordered or joined on. Nothing in this
 * codebase queries a secret by value; if something ever needs to, it needs a
 * separate deterministic index, not a weaker cipher here.
 *
 * ## The envelope
 *
 *     enc:v1:9f3a1c22:<base64 of iv(12) || tag(16) || ciphertext>
 *     ^   ^  ^          ^
 *     |   |  |          the payload
 *     |   |  key id -- which key wrote this (see secret-key-ring.ts)
 *     |   format version, so a future change is detectable rather than silent
 *     a marker that says "this is not plaintext"
 *
 * The prefix is what makes a partly-migrated database legible. A value that
 * does not start with `enc:` is a legacy plaintext secret written before this
 * layer existed, and `decryptSecret` returns it unchanged rather than throwing
 * — otherwise deploying this code would break every install that already had
 * an API key in the database, and the fix would arrive after the outage. That
 * tolerance is bounded on both ends: `npm run secrets:rewrap` encrypts those
 * values, and reading one logs a warning naming the column so the tolerance
 * does not quietly become the steady state.
 *
 * ## Why the column name is authenticated
 *
 * GCM's additional-authenticated-data is set to `<model>.<field>`, which binds
 * a ciphertext to the column it was written for. It is not encrypted and it is
 * not a secret; it means someone with write access to the database cannot move
 * a value between columns and have it decrypt — copying one tenant's Google
 * secret into another tenant's Facebook secret column produces a decrypt
 * failure instead of a working credential in the wrong place. It costs nothing
 * and closes an attack the cipher alone does not.
 */

const PREFIX = 'enc';
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Identifies the column a ciphertext belongs to, e.g. `email_provider_config`
 * + `brevoApiKey`. Both halves are known wherever encryption happens — the
 * extension has them from the query, the scripts write them literally.
 */
export interface SecretContext {
  readonly model: string;
  readonly field: string;
}

const aad = (context: SecretContext): Buffer =>
  Buffer.from(`${context.model}.${context.field}`, 'utf8');

/** True if `value` is one of our envelopes rather than a legacy plaintext. */
export function isEncryptedSecret(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:${VERSION}:`);
}

/** The key id an envelope names, or null if it is not an envelope. */
export function secretKeyIdOf(value: unknown): string | null {
  if (!isEncryptedSecret(value)) return null;
  return value.split(':', 3)[2] ?? null;
}

/** True if the value is already encrypted under the current primary key. */
export function isUnderPrimaryKey(value: unknown): boolean {
  return secretKeyIdOf(value) === secretKeyRing().primary.id;
}

/**
 * Encrypts under the primary key. Null and empty stay as they are: an unset
 * secret is a meaningful state ("this provider is off for this tenant"), and
 * encrypting the empty string would turn it into a value that looks set.
 */
export function encryptSecret<T extends string | null | undefined>(
  plaintext: T,
  context: SecretContext,
): T extends string ? string : T {
  type Result = T extends string ? string : T;
  if (plaintext === null || plaintext === undefined || plaintext === '') {
    return plaintext as Result;
  }

  const key: SecretKey = secretKeyRing().primary;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key.bytes, iv);
  cipher.setAAD(aad(context));

  const ciphertext = Buffer.concat([
    cipher.update(plaintext as string, 'utf8'),
    cipher.final(),
  ]);
  const payload = Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);

  return `${PREFIX}:${VERSION}:${key.id}:${payload.toString('base64')}` as Result;
}

/** Thrown when a value looks like an envelope but cannot be opened. */
export class SecretDecryptError extends Error {
  constructor(
    message: string,
    readonly context: SecretContext,
  ) {
    super(message);
    this.name = 'SecretDecryptError';
  }
}

/**
 * Decrypts an envelope, or passes a legacy plaintext through.
 *
 * `onLegacyPlaintext` is how the caller reports the tolerance being used --
 * the extension logs it. Kept as a callback rather than a logger import so
 * this module stays usable from the standalone scripts, which have no Nest
 * logger, and so the rewrap script can stay silent while it fixes them.
 */
export function decryptSecret<T extends string | null | undefined>(
  stored: T,
  context: SecretContext,
  onLegacyPlaintext?: (context: SecretContext) => void,
): T extends string ? string : T {
  type Result = T extends string ? string : T;
  if (stored === null || stored === undefined || stored === '') {
    return stored as Result;
  }

  if (!isEncryptedSecret(stored)) {
    onLegacyPlaintext?.(context);
    return stored as Result;
  }

  const parts = (stored as string).split(':');
  if (parts.length !== 4) {
    throw new SecretDecryptError(
      `Malformed secret envelope in ${context.model}.${context.field}.`,
      context,
    );
  }

  const [, , keyId, payloadB64] = parts;
  const key = secretKeyRing().byId.get(keyId);
  if (!key) {
    throw new SecretDecryptError(
      `${context.model}.${context.field} is encrypted under key ${keyId}, which ` +
        `this deployment does not hold. Add it to SECRET_ENCRYPTION_KEYS_RETIRED ` +
        `— it was almost certainly rotated out before \`npm run secrets:rewrap\` ran.`,
      context,
    );
  }

  const payload = Buffer.from(payloadB64, 'base64');
  if (payload.length <= IV_BYTES + TAG_BYTES) {
    throw new SecretDecryptError(
      `Truncated secret payload in ${context.model}.${context.field}.`,
      context,
    );
  }

  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = payload.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv('aes-256-gcm', key.bytes, iv);
  decipher.setAAD(aad(context));
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8') as Result;
  } catch {
    // GCM's own message ("Unsupported state or unable to authenticate data")
    // says nothing about which value failed, and this is exactly the moment
    // somebody needs to know that.
    throw new SecretDecryptError(
      `Failed to authenticate ${context.model}.${context.field}. The stored value ` +
        `was written under a different key or column, or has been altered.`,
      context,
    );
  }
}
