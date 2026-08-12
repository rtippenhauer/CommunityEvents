import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/database/prisma/prisma.service';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
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

  // Schema is applied once per run by test/global-setup.ts (prisma migrate
  // deploy), not here. app.init() no longer creates it: TypeORM's
  // migrationsRun did that as a side effect of booting, and Prisma has no
  // equivalent — migrations are a deploy step, which is also how the real
  // container does it.
  const prisma = moduleRef.get(PrismaService);

  return { app, prisma };
}

// Wipes every table between test files so each suite starts from a clean
// slate — simpler and safer than trying to roll back a transaction across
// real HTTP requests hitting a pooled connection.
export async function truncateAllTables(prisma: PrismaService): Promise<void> {
  // Refuse to run anywhere but a database named for testing. This function
  // truncates every table it finds, and the connection it is handed comes from
  // whatever DB_* env the app resolved — a stray value (or a tool that injects
  // the repo root .env over the environment, as the Prisma CLI does) would
  // point it at the dev database instead. Cheap check, unrecoverable mistake.
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT DATABASE() AS db`;
  if (!/_test$/.test(db ?? '')) {
    throw new Error(
      `Refusing to truncate "${db}": the e2e suite only runs against a database whose name ends in _test.`,
    );
  }

  const tables = await prisma.$queryRaw<{ TABLE_NAME: string }[]>`
    SELECT TABLE_NAME FROM information_schema.tables
    WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`;

  // One interactive transaction, not a sequence of loose statements, because
  // FOREIGN_KEY_CHECKS is per *connection*: PrismaService runs a pool of 10, so
  // a bare `SET FOREIGN_KEY_CHECKS = 0` lands on whichever connection it got
  // and the TRUNCATEs that follow run on other connections that still enforce
  // the constraints ("Cannot truncate a table referenced in a foreign key
  // constraint"). $transaction pins one connection for the whole callback.
  // TRUNCATE implicitly commits in MySQL, so this is a connection lease rather
  // than a real atomic unit — which is all that is needed here.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
      for (const { TABLE_NAME } of tables) {
        // _prisma_migrations records which migrations have been applied. Wiping
        // it would make the next run think the schema was never created.
        if (TABLE_NAME === '_prisma_migrations') continue;
        await tx.$executeRawUnsafe(`TRUNCATE TABLE \`${TABLE_NAME}\``);
      }
      await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
    },
    { timeout: 30000 },
  );
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
