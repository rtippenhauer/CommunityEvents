/**
 * Discards every stored secret, so a deployment whose key is gone can start
 * over (v2-7).
 *
 * This is the recovery path for the one failure encryption at rest cannot
 * otherwise survive: the key is lost and the ciphertext is therefore permanently
 * unreadable. Nothing here decrypts anything — it sets every encrypted column to
 * NULL, which returns each setting to "not configured" and lets the next start
 * generate a fresh key.
 *
 * **It destroys data, and the data it destroys is exactly the data nobody can
 * re-derive.** Every API key an operator or a community entered has to be
 * fetched from the provider and typed in again. That is the whole cost of losing
 * a key, and it is why the startup check refuses to generate a new key over a
 * populated database rather than doing this quietly.
 *
 * Guarded by an explicit environment variable rather than a prompt, because it
 * runs inside a container where there is no terminal to prompt on. The value is
 * a phrase and not `true`, for the same reason deleting a community makes you
 * retype its domain: a flag you can set by accident is not a confirmation.
 *
 *     CONFIRM_SECRET_RESET=discard-all-stored-secrets node dist/reset-secrets.js
 *
 * Uses a bare PrismaClient, like the rewrap: the encryption extension would try
 * to decrypt what it reads, and being unable to decrypt is the situation this
 * exists for.
 */

import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { allEncryptedColumns } from './common/crypto/encrypted-columns';
import { keyFilePath } from './common/crypto/secret-key-ring';

const CONFIRM_ENV = 'CONFIRM_SECRET_RESET';
const CONFIRM_PHRASE = 'discard-all-stored-secrets';

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

async function main(): Promise<void> {
  if (process.env[CONFIRM_ENV] !== CONFIRM_PHRASE) {
    console.error(
      `Refusing to run. This discards every credential stored in the database -- the email\n` +
        `provider keys, every community's own API keys, and any per-tenant OAuth secrets.\n` +
        `They cannot be recovered afterwards and have to be re-entered from each provider.\n\n` +
        `Only do this if the encryption key is genuinely lost. If it is not, ` +
        `\`npm run secrets:rewrap\`\nwill move everything onto a new key without losing a thing.\n\n` +
        `To proceed:\n\n    ${CONFIRM_ENV}=${CONFIRM_PHRASE}\n`,
    );
    process.exit(1);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaMariaDb({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      allowPublicKeyRetrieval: true,
      timezone: 'Z',
    }),
  });

  let cleared = 0;
  try {
    for (const { model, field } of allEncryptedColumns()) {
      const { table, column } = physicalNames(model, field);
      const affected = await prisma.$executeRawUnsafe(
        `UPDATE \`${table}\` SET \`${column}\` = NULL WHERE \`${column}\` IS NOT NULL`,
      );
      cleared += affected;
      console.log(`  ${model}.${field}: cleared ${affected}`);
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\nCleared ${cleared} stored secret(s).`);
  console.log(
    `\nNext: remove the unreadable key so a new one can be generated -- unset ` +
      `SECRET_ENCRYPTION_KEY\nand delete ${keyFilePath()} if either still holds the lost ` +
      `key -- then restart. The API will\ngenerate a fresh key, because the database now has ` +
      `nothing it could fail to decrypt.\n\nThen re-enter each API key: Admin -> Email for ` +
      `the provider keys, Admin -> API Keys per\ncommunity.`,
  );
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('\nReset failed.');
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
