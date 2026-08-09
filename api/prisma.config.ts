import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

// Load the repo-root .env rather than an api/.env, so there is exactly one
// dev env file. TypeORM's data-source.ts already resolves the root .env the
// same way; keeping both on one file avoids the two drifting apart while the
// swap is in progress and both are briefly live.
dotenv.config({ path: path.join(__dirname, '../.env') });

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
