import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma/prisma.service';
import { TenantResolutionService } from '../../common/tenant/tenant-resolution.service';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * How the requesting Host resolved (REQ-TENANT-01.2).
 *
 * `unrecognized` is not a failure of this deployment — the app is healthy and
 * the caller simply used a hostname no tenant claims — so it does not degrade
 * the overall status. `none` is: it means the database was migrated and seeded
 * but never bootstrapped, and every request to every tenant-scoped route will
 * fail until someone runs bootstrap. `unknown` means the database was
 * unreachable, so resolution could not be attempted at all.
 */
export type TenantHealth = 'ok' | 'suspended' | 'unrecognized' | 'none' | 'unknown';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  timestamp: string;
  database: 'ok' | 'error';
  tenant: TenantHealth;
  version: string;
  gitCommit: string;
}

// Read once at module load — the container's WORKDIR (/app) always has
// package.json alongside dist/, so this reflects whatever was actually
// baked into the deployed image, not just what's tagged in git.
const { version: appVersion } = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf-8'),
);

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantResolutionService,
  ) {}

  async check(host?: string): Promise<HealthStatus> {
    let database: 'ok' | 'error' = 'error';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = 'ok';
    } catch {
      // DB unreachable — status stays 'error'
    }

    const tenant = database === 'ok' ? await this.resolveTenantHealth(host) : 'unknown';

    // This endpoint is exempt from TenantMiddleware precisely so it can report
    // these two states rather than be silenced by them, so an unbootstrapped
    // deployment has to show up here as degraded — it is the only place that
    // says so.
    const healthy = database === 'ok' && tenant !== 'none';

    return {
      status: healthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database,
      tenant,
      version: appVersion,
      gitCommit: process.env.GIT_COMMIT ?? 'unknown',
    };
  }

  private async resolveTenantHealth(host?: string): Promise<TenantHealth> {
    try {
      const resolution = await this.tenants.resolve(host);
      switch (resolution.outcome) {
        case 'resolved':
          return 'ok';
        case 'suspended':
          return 'suspended';
        case 'not-configured':
          return 'none';
        case 'unrecognized':
          return 'unrecognized';
      }
    } catch {
      // The SELECT 1 above succeeded, so this is not a dead database — but
      // health must answer either way rather than 500 on a diagnostic route.
      return 'unknown';
    }
  }
}
