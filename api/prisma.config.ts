import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

// Load the repo-root .env rather than an api/.env, so there is exactly one
// dev env file. TypeORM's data-source.ts already resolves the root .env the
// same way; keeping both on one file avoids the two drifting apart while the
// swap is in progress and both are briefly live.
dotenv.config({ path: path.join(__dirname, '../.env') });

/**
 * Deployments configure the database with DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/
 * DB_NAME -- the same vars the app itself reads -- and have no DATABASE_URL.
 * Rather than make every environment define a second, redundant setting that
 * could drift from the first, derive the URL when it is not set explicitly.
 */
function databaseUrl(): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;
  if (!DB_HOST || !DB_USER || !DB_NAME) return undefined;

  const user = encodeURIComponent(DB_USER);
  const password = encodeURIComponent(DB_PASSWORD ?? '');
  return `mysql://${user}:${password}@${DB_HOST}:${DB_PORT ?? '3306'}/${DB_NAME}`;
}

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    // Reference/config data a blank install needs, on demand via `npm run
    // seed`. ts-node is a devDependency and is pruned from the production
    // image, so the container seeds a fresh database with the compiled copy
    // instead: `node /app/dist/database/prisma/seed.js`. Same source file.
    seed: 'ts-node --compiler-options {"module":"CommonJS"} src/database/prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl(),
  },
});
