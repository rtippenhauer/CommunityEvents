import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';

/**
 * Shared data-access point for the whole API, replacing TypeOrmModule.
 *
 * Prisma 7 does not take a connection string in schema.prisma — the client is
 * constructed with a driver adapter instead. `@prisma/adapter-mariadb` is the
 * MySQL adapter despite the name; it speaks the MySQL protocol and is what
 * Prisma ships for both MySQL and MariaDB.
 *
 * Connection settings are read from the same DB_* env vars TypeORM used, so a
 * deployment does not have to change its environment to move onto Prisma. The
 * pool options mirror the ones the TypeORM config carried, including the
 * keep-alive that stops MySQL's wait_timeout from silently dropping idle
 * connections between requests.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private static readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService) {
    super({
      adapter: new PrismaMariaDb({
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: Number(configService.get<string | number>('DB_PORT', 3306)),
        user: configService.get<string>('DB_USER'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_NAME'),
        connectionLimit: 10,
        // mariadb's driver keeps sockets alive itself; this is the equivalent
        // of TypeORM's enableKeepAlive/keepAliveInitialDelay pairing.
        keepAliveDelay: 10000,
        // Pinned rather than left to the driver default, because TypeORM and
        // Prisma disagree here. mysql2 (TypeORM) read naive DATETIME columns
        // as the Node process's LOCAL time; the mariadb driver reads them as
        // UTC. Production containers run their clock in UTC, so the two agree
        // there and only diverge on a non-UTC dev machine -- where v1 was
        // quietly shifting every timestamp by the local offset. 'Z' matches
        // what the data actually means and makes dev behave like production.
        timezone: 'Z',
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    PrismaService.logger.log('Prisma connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
