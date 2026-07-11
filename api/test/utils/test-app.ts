import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser = require('cookie-parser');
import session = require('express-session');
import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';

export interface TestApp {
  app: INestApplication;
  dataSource: DataSource;
}

// Boots the real AppModule end to end (real guards, real DB, real HTTP
// stack) against the ephemeral test MySQL instance — the only things that
// differ from main.ts are the listening port (ephemeral, via supertest)
// and the dummy secrets from test/setup-env.ts.
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();

  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.use(
    session({
      secret: 'test-session-secret-not-for-real-use',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 10 * 60 * 1000 },
    }),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  await app.init();

  // Schema comes from the real migration history — AppModule already sets
  // migrationsRun: true, so this runs automatically as part of app.init()
  // (same as a real dev/stage/prod boot), no separate CLI step needed.
  const dataSource = moduleRef.get(DataSource);

  return { app, dataSource };
}

// Wipes every table between test files so each suite starts from a clean
// slate — simpler and safer than trying to roll back a transaction across
// real HTTP requests hitting a pooled connection.
export async function truncateAllTables(dataSource: DataSource): Promise<void> {
  const tables: Array<{ TABLE_NAME: string }> = await dataSource.query(
    'SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE()',
  );
  await dataSource.query('SET FOREIGN_KEY_CHECKS = 0');
  for (const { TABLE_NAME } of tables) {
    if (TABLE_NAME === 'migrations') continue;
    await dataSource.query(`TRUNCATE TABLE \`${TABLE_NAME}\``);
  }
  await dataSource.query('SET FOREIGN_KEY_CHECKS = 1');
}

// Auth routes carry tight per-route @Throttle limits (e.g. 5/min on register,
// 3/min on forgot-password) enforced by a real global APP_GUARD, and a single
// app instance is reused across every test in a spec file — without a reset,
// tests that legitimately call the same route more than a handful of times
// start tripping 429s that have nothing to do with the behavior under test.
// Clearing the in-memory storage between tests keeps the guard real (it still
// fires within a single test that deliberately exceeds the limit) without
// letting unrelated tests interfere with each other.
export function resetThrottler(app: INestApplication): void {
  const storage = app.get(ThrottlerStorage) as unknown as {
    storage: Map<string, unknown>;
    timeoutIds?: Map<string, NodeJS.Timeout[]>;
  };
  // ThrottlerStorageService schedules a setTimeout per hit to decrement its
  // counter later; clearing `storage` without also cancelling those timers
  // leaves orphaned callbacks that fire against now-missing entries and throw
  // ("Cannot destructure property 'totalHits' of ... undefined") during a
  // later, unrelated test.
  storage.timeoutIds?.forEach((ids) => ids.forEach((id) => clearTimeout(id)));
  storage.timeoutIds?.clear();
  storage.storage.clear();
}
