import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import './setup-env';

// Creates the schema once per run, before any spec boots the app.
//
// Under TypeORM this happened implicitly: test-app.ts booted the app with
// `migrationsRun: true`, so every spec file rebuilt (or re-verified) the
// schema as a side effect of app.init(). Prisma has no equivalent — migrations
// are a deploy step, not a connection option — so it becomes an explicit
// globalSetup. That also matches how the real container does it
// (docker/entrypoint.sh runs `prisma migrate deploy` before starting Nest).
export default function globalSetup(): void {
  const apiDir = path.join(__dirname, '..');
  // Resolve Prisma's own entry rather than shelling out to `npx prisma`, which
  // is slow and can go to the network on a cold cache.
  const prismaCli = require.resolve('prisma/build/index.js');

  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

  // DATABASE_URL, not the DB_* vars, because the Prisma CLI injects the repo
  // root .env over the environment it was invoked with — passing DB_PORT=3307
  // here is silently replaced by the dev database's 3308 and the migration
  // lands in the wrong database. The root .env defines no DATABASE_URL, so
  // this one survives. prisma.config.ts prefers it over the DB_* vars.
  const databaseUrl = `mysql://${encodeURIComponent(DB_USER!)}:${encodeURIComponent(
    DB_PASSWORD ?? '',
  )}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
}
