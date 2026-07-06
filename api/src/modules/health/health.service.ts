import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  timestamp: string;
  database: 'ok' | 'error';
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
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async check(): Promise<HealthStatus> {
    let database: 'ok' | 'error' = 'error';
    try {
      await this.dataSource.query('SELECT 1');
      database = 'ok';
    } catch {
      // DB unreachable — status stays 'error'
    }

    return {
      status: database === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      database,
      version: appVersion,
      gitCommit: process.env.GIT_COMMIT ?? 'unknown',
    };
  }
}
