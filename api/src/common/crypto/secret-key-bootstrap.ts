import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { allEncryptedColumns } from './encrypted-columns';
import { isEncryptedSecret, secretKeyIdOf } from './secret-cipher';
import {
  generateSecretKey,
  keyFileLooksPersistent,
  keyFilePath,
  PRIMARY_KEY_ENV,
  persistSecretKey,
  resetSecretKeyRing,
  RETIRED_KEYS_ENV,
  secretKeyRing,
} from './secret-key-ring';

/**
 * Decides, at startup, whether this deployment may generate its own encryption
 * key — and refuses to run with the wrong one (v2-7).
 *
 * ## Why the database does not hold the key
 *
 * The obvious design is to keep the key alongside the data it protects, so a
 * deployment is self-contained. It is also the one design that cannot work:
 * encryption at rest exists to make a database dump useless, and a dump that
 * contains the key is not useless. Anything stored in the database can only
 * ever be a *fingerprint* — enough to tell whether the key you hold is the
 * right one, never enough to reconstruct it.
 *
 * That fingerprint already exists and costs nothing extra: every envelope
 * written by secret-cipher.ts names the key id that wrote it. So the data can
 * answer "is this the right key?" without ever holding one.
 *
 * ## The three states
 *
 * **Fresh deployment** — no key anywhere, and no encrypted value in the
 * database. Generating one is safe because there is nothing it could fail to
 * decrypt, so the API generates, writes it to the key file, and logs loudly
 * that it must be backed up. This is what removes the manual step from a first
 * install.
 *
 * **Populated deployment, key present** — the key is checked against what is
 * actually stored. A key id in the data that the ring cannot supply is a
 * refusal to start, naming the id, because the alternative is an API that comes
 * up healthy and fails on the first password-reset email.
 *
 * **Populated deployment, no key** — refuse, and say so in terms of what
 * happened: the key file was lost or its volume is not mounted. Generating here
 * would produce a deployment that starts cleanly and cannot read a single one
 * of its own credentials. If the key really is gone, `secrets:reset` is the
 * explicit way to discard the secrets and start over.
 */

/** How many stored values to sample per column when checking key ids. */
const SAMPLE_LIMIT = 50;

const logger = new Logger('SecretKeyBootstrap');

/** The physical table and column behind a Prisma model/field pair. */
function physicalNames(model: string, field: string): { table: string; column: string } {
  const dmmfModel = Prisma.dmmf.datamodel.models.find((entry) => entry.name === model);
  if (!dmmfModel) throw new Error(`No such model in the schema: ${model}`);

  const dmmfField = dmmfModel.fields.find((entry) => entry.name === field);
  if (!dmmfField) throw new Error(`No such field in the schema: ${model}.${field}`);

  return {
    table: dmmfModel.dbName ?? dmmfModel.name,
    column: dmmfField.dbName ?? dmmfField.name,
  };
}

/** Just enough of PrismaService to read raw rows, so tests can pass a stub. */
export interface RawQueryClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

/**
 * Every distinct key id present in the database.
 *
 * Deliberately raw SQL. Reading these columns through the client would route
 * them through the encryption extension, which would decrypt them — and
 * decrypting is exactly what may be about to fail. Identifiers are interpolated
 * rather than bound because they come from the generated DMMF, not from input.
 */
export async function storedKeyIds(client: RawQueryClient): Promise<Set<string>> {
  const found = new Set<string>();

  for (const { model, field } of allEncryptedColumns()) {
    const { table, column } = physicalNames(model, field);

    const rows = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT \`${column}\` AS value FROM \`${table}\` WHERE \`${column}\` IS NOT NULL LIMIT ${SAMPLE_LIMIT}`,
    );

    for (const row of rows) {
      const value = row.value;
      // A legacy plaintext value has no key id and is not evidence of anything:
      // it predates encryption, and the rewrap will bring it under the current
      // key whatever that turns out to be.
      if (!isEncryptedSecret(value)) continue;
      const id = secretKeyIdOf(value);
      if (id) found.add(id);
    }
  }

  return found;
}

/**
 * Resolves this deployment's key, generating one only when that cannot lose
 * anything, and verifies it against what is stored.
 *
 * Called once at startup, after the database is reachable. Throws with an
 * operator-actionable message rather than letting the API come up in a state
 * where every credential read will fail.
 */
export async function ensureDeploymentKey(client: RawQueryClient): Promise<void> {
  let haveKey = true;
  try {
    secretKeyRing();
  } catch (err) {
    // A key that exists but is malformed is a different problem from no key at
    // all, and generating over it would bury the operator's typo.
    if (!(err instanceof Error) || !err.message.startsWith('No encryption key:')) throw err;
    haveKey = false;
  }

  const stored = await storedKeyIds(client);

  if (!haveKey) {
    if (stored.size > 0) {
      throw new Error(
        `This database holds secrets encrypted under key(s) ${[...stored].join(', ')}, but no ` +
          `key is available. Set ${PRIMARY_KEY_ENV}, or restore the key file at ` +
          `${keyFilePath()} — its volume may simply not be mounted. Generating a new key ` +
          `would not recover anything: if the key is genuinely lost, run ` +
          `\`npm run secrets:reset\` to discard the stored secrets and start over.`,
      );
    }

    const key = generateSecretKey();
    const path = persistSecretKey(key);
    // Put it in the environment too, so the ring picks it up without re-reading
    // the file it was just written to.
    process.env[PRIMARY_KEY_ENV] = key;
    resetSecretKeyRing();
    secretKeyRing();

    logger.warn(
      `No encryption key was configured and this database holds no secrets, so one has been ` +
        `generated and written to ${path}. BACK IT UP. Every credential this deployment ` +
        `stores is encrypted under it, it is not recoverable from the database, and losing ` +
        `it means re-entering every secret by hand.`,
    );

    // The stage pass for v2-7 generated three keys in a row because
    // /app/appdata was not mapped to a host path. Nothing was lost -- generating
    // requires an empty database -- but "BACK IT UP" pointed at a file that
    // could not survive the next `docker run`, which is a worse instruction than
    // none. Loud, and separate from the message above, because it changes what
    // the operator has to do next.
    if (!keyFileLooksPersistent()) {
      logger.error(
        `${path} does not look like it is on a mounted volume -- its directory shares a ` +
          `filesystem with its parent, which is what an unmapped container path looks like. ` +
          `If that is right, this key is lost the moment the container is recreated, and any ` +
          `secret encrypted under it goes with it. Map that directory to persistent storage, ` +
          `or set ${PRIMARY_KEY_ENV} explicitly, before storing any credential.`,
      );
    }
    return;
  }

  const ring = secretKeyRing();
  const unreadable = [...stored].filter((id) => !ring.byId.has(id));

  if (unreadable.length > 0) {
    throw new Error(
      `This database holds secrets encrypted under key(s) ${unreadable.join(', ')}, which this ` +
        `deployment does not hold — its primary key is ${ring.primary.id}. Add the missing ` +
        `key(s) to ${RETIRED_KEYS_ENV} and run \`npm run secrets:rewrap\`, or run ` +
        `\`npm run secrets:reset\` to discard the stored secrets if the key is gone for good. ` +
        `Refusing to start: every credential read would fail.`,
    );
  }

  // Not an error -- this is the normal state midway through a rotation, between
  // restarting on the new key and running the rewrap. Worth saying out loud,
  // because the other way to reach it is an operator who thinks the rotation
  // finished.
  const notCurrent = [...stored].filter((id) => id !== ring.primary.id);
  if (notCurrent.length > 0) {
    logger.warn(
      `Some stored secrets are still encrypted under retired key(s) ${notCurrent.join(', ')}. ` +
        `They are readable, but the rotation is not finished — run \`npm run secrets:rewrap\`.`,
    );
  }
}
