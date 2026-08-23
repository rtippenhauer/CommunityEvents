/**
 * Rewraps every stored secret under the current primary key (v2-7).
 *
 * One script, two jobs, because they are the same job:
 *
 *  - **Migration.** A database that predates encryption holds plaintext in the
 *    encrypted columns. Reads tolerate that (see secret-cipher.ts) so deploying
 *    this code does not break an install mid-flight; this is what ends the
 *    tolerance. Run it once after upgrading.
 *
 *  - **Rotation.** This is the answer to "what happens when a key has to
 *    change", and the reason that answer does not involve re-entering any
 *    secret by hand:
 *
 *      1. move the current `SECRET_ENCRYPTION_KEY` into
 *         `SECRET_ENCRYPTION_KEYS_RETIRED` (comma-separated; keep any already
 *         there),
 *      2. put the new key in `SECRET_ENCRYPTION_KEY`,
 *      3. restart — every existing value still decrypts, because ciphertext
 *         names the key that wrote it,
 *      4. run this,
 *      5. drop the retired key from the environment once it reports nothing
 *         left to do.
 *
 *    Steps 3 and 4 are separable on purpose: the deployment is fully working
 *    between them, so a rotation is never a window during which the site is
 *    down if the script fails.
 *
 * Uses a **bare** PrismaClient, with neither extension applied. That is the
 * whole trick — the encryption extension would decrypt on read and encrypt on
 * write, so a rewrap through the normal client would be a no-op that reported
 * success, and tenant scoping would hide every community but one.
 */

import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import { allEncryptedColumns } from './common/crypto/encrypted-columns';
import {
  decryptSecret,
  encryptSecret,
  isUnderPrimaryKey,
  secretKeyIdOf,
} from './common/crypto/secret-cipher';
import { secretKeyRing } from './common/crypto/secret-key-ring';

/** The delegate shape this script needs from any model, whatever it is. */
interface RewrapDelegate {
  findMany(args: { select: Record<string, boolean> }): Promise<Array<Record<string, unknown>>>;
  update(args: { where: { id: number }; data: Record<string, string> }): Promise<unknown>;
}

export interface ColumnResult {
  readonly column: string;
  readonly fromPlaintext: number;
  readonly fromRetiredKey: number;
  readonly alreadyCurrent: number;
  readonly empty: number;
}

/** Minimal client surface, so a spec can hand this a bare client of its own. */
export type RewrapClient = Record<string, unknown>;

/**
 * Rewraps every encrypted column of every row, reporting what it did.
 *
 * Separated from the command-line wrapper so it can be exercised against a real
 * database in the e2e suite. A rotation path that has never been run is not a
 * rotation path, and the failure it exists to prevent -- unreadable secrets --
 * is the one nobody discovers until they need it.
 *
 * `client` must have **no extensions applied**. Rewrapping through the
 * encryption extension would decrypt on read and encrypt on write, so this
 * would report success having changed nothing, and tenant scoping would hide
 * every community but one.
 */
export async function rewrapSecrets(client: RewrapClient): Promise<ColumnResult[]> {
  const results: ColumnResult[] = [];

  for (const { model, field } of allEncryptedColumns()) {
    const delegate = (client as unknown as Record<string, RewrapDelegate>)[model];
    if (!delegate) {
      throw new Error(`No Prisma delegate for model ${model} — is the client generated?`);
    }

    const rows = await delegate.findMany({ select: { id: true, [field]: true } });

    let fromPlaintext = 0;
    let fromRetiredKey = 0;
    let alreadyCurrent = 0;
    let empty = 0;

    for (const row of rows) {
      const stored = row[field];
      const id = row.id as number;

      if (typeof stored !== 'string' || stored === '') {
        empty++;
        continue;
      }

      if (isUnderPrimaryKey(stored)) {
        alreadyCurrent++;
        continue;
      }

      // No onLegacyPlaintext callback: a bare value here is expected, it is
      // what this script exists to fix, and warning about it while fixing it
      // would be noise.
      const plaintext = decryptSecret(stored, { model, field });
      await delegate.update({
        where: { id },
        data: { [field]: encryptSecret(plaintext, { model, field }) },
      });

      if (secretKeyIdOf(stored) === null) fromPlaintext++;
      else fromRetiredKey++;
    }

    results.push({
      column: `${model}.${field}`,
      fromPlaintext,
      fromRetiredKey,
      alreadyCurrent,
      empty,
    });
  }

  return results;
}

async function main(): Promise<void> {
  // Throws with an actionable message if the environment is missing or
  // malformed, before anything is read or written.
  const ring = secretKeyRing();
  console.log(`Primary key: ${ring.primary.id}`);
  console.log(
    ring.byId.size > 1
      ? `Also holding ${ring.byId.size - 1} retired key(s): ` +
          `${[...ring.byId.keys()].filter((id) => id !== ring.primary.id).join(', ')}`
      : 'No retired keys configured.',
  );

  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      // MySQL 8/9 need this to complete a first-time caching_sha2_password
      // handshake over a non-TLS link; see PrismaService for the full note.
      allowPublicKeyRetrieval: true,
      timezone: 'Z',
    }),
  });

  let results: ColumnResult[];
  try {
    results = await rewrapSecrets(prisma as unknown as RewrapClient);
  } finally {
    await prisma.$disconnect();
  }

  console.log('');
  let rewrapped = 0;
  for (const result of results) {
    rewrapped += result.fromPlaintext + result.fromRetiredKey;
    console.log(
      `  ${result.column}: ` +
        `${result.fromPlaintext} encrypted from plaintext, ` +
        `${result.fromRetiredKey} moved off a retired key, ` +
        `${result.alreadyCurrent} already current, ` +
        `${result.empty} empty`,
    );
  }

  console.log('');
  if (rewrapped === 0) {
    console.log(
      'Nothing to do — every stored secret is already under the primary key. ' +
        'Any retired keys can now be removed from SECRET_ENCRYPTION_KEYS_RETIRED.',
    );
  } else {
    console.log(
      `Rewrapped ${rewrapped} value(s) under key ${secretKeyRing().primary.id}. ` +
        'Re-run to confirm nothing is left, then drop any retired keys.',
    );
  }
}

// Only when run as a command. The e2e suite imports rewrapSecrets directly and
// must not open a connection to whatever DB_* the environment holds at import
// time.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('\nRewrap failed. No further rows were written.');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
