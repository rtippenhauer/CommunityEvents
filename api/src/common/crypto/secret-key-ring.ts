import { createHash, randomBytes } from 'crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

/**
 * The set of AES keys this deployment can decrypt with, and the one it encrypts
 * with (v2-7).
 *
 * Reads `process.env` directly rather than going through `ConfigService`, for
 * the same reason `isStageDeployment()` does and no further: `bootstrap.ts`,
 * `provision-tenant.ts`, `seed.ts` and `rewrap-secrets.ts` are plain node
 * processes with no Nest container, and all four have to encrypt or decrypt.
 * A key that only the injected half of the codebase could reach would leave the
 * install path writing plaintext.
 *
 * ## Where the key comes from
 *
 * `SECRET_ENCRYPTION_KEY` — one base64 32-byte key, the *primary*: everything
 * written from now on is encrypted under it. Bootstrap config in the
 * REQ-TENANT-01.4 sense, and unavoidably so; it is how the process reads its
 * own configuration, so it cannot live in the configuration. Generate with
 * `openssl rand -base64 32`.
 *
 * If the variable is unset, the key is read from a **file** instead --
 * `SECRET_ENCRYPTION_KEY_FILE`, defaulting to the container's persistent
 * appdata volume. That file is what a fresh deployment generates for itself, so
 * an operator does not have to produce 32 bytes of base64 before the API will
 * start. See secret-key-bootstrap.ts for when generating is allowed, and for
 * why the key is never kept in the database it protects.
 *
 * `SECRET_ENCRYPTION_KEYS_RETIRED` — zero or more comma-separated keys of the
 * same shape, used for *decryption only*. This is the whole of the rotation
 * story: move the old key here, put a new one in `SECRET_ENCRYPTION_KEY`,
 * restart, and every existing ciphertext still reads. `npm run secrets:rewrap`
 * then rewrites them under the new primary at leisure, after which the retired
 * entry can be dropped. Nobody re-enters a secret by hand at any point.
 *
 * ## Why ciphertext names its key
 *
 * Each key has a short public *key id*, derived from the key by a hash it
 * cannot be reversed through, and every envelope carries it. Without that,
 * rotation would mean trial-decrypting against every key in the ring — which
 * works, but cannot tell "this ciphertext is under the old key" apart from
 * "this ciphertext is corrupt", and those want opposite responses. It is also
 * what lets the rewrap script find the rows that still need rewriting instead
 * of rewriting all of them.
 */

/** Raw 32-byte AES-256 key plus the public id that identifies it. */
export interface SecretKey {
  readonly id: string;
  readonly bytes: Buffer;
}

export const PRIMARY_KEY_ENV = 'SECRET_ENCRYPTION_KEY';
export const RETIRED_KEYS_ENV = 'SECRET_ENCRYPTION_KEYS_RETIRED';
export const KEY_FILE_ENV = 'SECRET_ENCRYPTION_KEY_FILE';

/**
 * Where a generated key is kept when no env var supplies one.
 *
 * `/app/appdata` is the container's persistent volume -- the same one the
 * entrypoint already sources `.env` from -- so the key survives a container
 * rebuild, which is the whole point. It is deliberately NOT the database: a key
 * stored beside the ciphertext it protects is readable by anyone holding the
 * dump, which is the exact threat encryption at rest defends against.
 */
const DEFAULT_KEY_FILE = '/app/appdata/secret-encryption.key';

export const keyFilePath = (): string => process.env[KEY_FILE_ENV] ?? DEFAULT_KEY_FILE;

/** The key file's contents, or null if there is no readable file. */
function readKeyFile(): string | null {
  const path = keyFilePath();
  try {
    if (!existsSync(path)) return null;
    const contents = readFileSync(path, 'utf8').trim();
    return contents.length > 0 ? contents : null;
  } catch {
    // An unreadable file is reported as absent rather than thrown: the env var
    // may still supply a key, and if it does not, the caller's "no key" error
    // already names the file and says what to do.
    return null;
  }
}

/** 32 fresh random bytes, base64 -- the same shape `openssl rand -base64 32` emits. */
export function generateSecretKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

/**
 * Writes a key to the key file, owner-readable only, and returns the path.
 *
 * Refuses to overwrite an existing file. Replacing a key file in place would
 * silently orphan every secret already encrypted under the old one, and the
 * supported way to change keys is a rotation (see rewrap-secrets.ts), which
 * keeps the old key readable throughout.
 */
export function persistSecretKey(key: string): string {
  const path = keyFilePath();
  if (existsSync(path)) {
    throw new Error(`Refusing to overwrite an existing key file at ${path}.`);
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${key}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    // Belt and braces: `mode` on writeFileSync is masked by the process umask,
    // and the entrypoint chmod 777s this volume on every start.
    chmodSync(path, 0o600);
  } catch {
    // Best effort -- a permissions failure here is worth neither a crash nor a
    // second code path, and the file is still no more exposed than the .env
    // sitting beside it.
  }
  return path;
}

/** AES-256. Any other length is a misconfiguration, not a shorter key. */
const KEY_BYTES = 32;

/**
 * Public, non-reversible name for a key.
 *
 * Domain-separated so this hash can never collide with one computed over the
 * same bytes for another purpose, and truncated to 8 hex characters because it
 * only has to distinguish the two or three keys a deployment holds at once —
 * it is an identifier, not an authenticator, and nothing trusts it.
 */
export function keyIdFor(bytes: Buffer): string {
  return createHash('sha256')
    .update('communityevents:secret-key-id:')
    .update(bytes)
    .digest('hex')
    .slice(0, 8);
}

function parseKey(raw: string, source: string): SecretKey {
  const bytes = Buffer.from(raw.trim(), 'base64');
  if (bytes.length !== KEY_BYTES) {
    throw new Error(
      `${source} is not a valid encryption key: expected ${KEY_BYTES} bytes of ` +
        `base64, got ${bytes.length}. Generate one with \`openssl rand -base64 32\`.`,
    );
  }
  return { id: keyIdFor(bytes), bytes };
}

export interface SecretKeyRing {
  /** The key new ciphertext is written under. */
  readonly primary: SecretKey;
  /** Primary + retired, by key id — every key this deployment can read with. */
  readonly byId: ReadonlyMap<string, SecretKey>;
}

let cached: SecretKeyRing | null = null;

/**
 * Builds the ring from the environment, or throws with a message an operator
 * can act on.
 *
 * Cached after the first successful call: the keys do not change within a
 * process, and re-deriving key ids per encrypted column would put a SHA-256 on
 * a hot path for no reason. `resetSecretKeyRing()` exists for tests only.
 */
export function secretKeyRing(): SecretKeyRing {
  if (cached) return cached;

  // Env wins over the file, so an operator can always override what a
  // deployment generated for itself without deleting anything.
  const fromEnv = process.env[PRIMARY_KEY_ENV];
  const rawPrimary = fromEnv && fromEnv.trim() ? fromEnv : readKeyFile();

  if (!rawPrimary) {
    throw new Error(
      `No encryption key: ${PRIMARY_KEY_ENV} is unset and there is no key file at ` +
        `${keyFilePath()}. Secrets are encrypted at rest, so the API cannot read ` +
        `or write them without one. A brand-new deployment generates its own on ` +
        `first start; this message means either the key file has been lost, or ` +
        `its volume is not mounted. Generate one with \`openssl rand -base64 32\` ` +
        `only if this database has no secrets in it yet — a new key cannot read ` +
        `values written under the old one.`,
    );
  }

  const primary = parseKey(
    rawPrimary,
    fromEnv && fromEnv.trim() ? PRIMARY_KEY_ENV : `key file ${keyFilePath()}`,
  );
  const byId = new Map<string, SecretKey>([[primary.id, primary]]);

  const retired = (process.env[RETIRED_KEYS_ENV] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of retired) {
    const key = parseKey(entry, RETIRED_KEYS_ENV);
    // A retired key equal to the primary is harmless but always a mistake --
    // most likely a rotation where the old value was never removed, which
    // means the operator believes they have rotated and they have not.
    if (key.id === primary.id) {
      throw new Error(
        `${RETIRED_KEYS_ENV} contains the same key as ${PRIMARY_KEY_ENV} ` +
          `(id ${key.id}). Retire the *previous* key, not the current one.`,
      );
    }
    byId.set(key.id, key);
  }

  cached = { primary, byId };
  return cached;
}

/** Test seam. Never call this from application code. */
export function resetSecretKeyRing(): void {
  cached = null;
}
