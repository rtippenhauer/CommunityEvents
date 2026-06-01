import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  timestamp: string;
  database: 'ok' | 'error';
}

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
    };
  }
}
