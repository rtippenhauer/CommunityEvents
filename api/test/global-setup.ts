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

  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: apiDir,
    stdio: 'inherit',
    env: process.env,
  });
}
