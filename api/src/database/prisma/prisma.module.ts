import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { tenantScopeExtension } from './tenant-scope.extension';

/**
 * Global so feature modules can inject PrismaService without each one
 * importing a module first. This is the Prisma equivalent of the
 * `TypeOrmModule.forFeature(...)` lines being removed from every feature
 * module — with Prisma there is nothing per-entity to register, so a single
 * global provider replaces all of them.
 *
 * The provider is a factory rather than the bare class because tenant scoping
 * arrives via `$extends`, which returns a *new* client rather than mutating the
 * one it was called on — so `PrismaService` cannot extend itself in its own
 * constructor. Binding the extended client to the `PrismaService` token instead
 * means all 40 injection sites keep working untouched, and no service can
 * accidentally reach the unscoped client: it is never bound to a token at all.
 *
 * Two properties of `$extends` make this safe, both verified against the real
 * client rather than assumed. The returned object forwards unknown properties to
 * its target, so `onModuleInit`/`onModuleDestroy` still resolve and Nest's
 * lifecycle hooks fire as usual; and it forwards `$connect`, `$disconnect`,
 * `$transaction` and the raw-query helpers. The one thing it does not preserve
 * is `instanceof PrismaService`, which nothing here relies on — injection and
 * `moduleRef.get()` are both token-based.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: PrismaService,
      useFactory: (configService: ConfigService): PrismaService =>
        new PrismaService(configService).$extends(
          tenantScopeExtension,
        ) as unknown as PrismaService,
      inject: [ConfigService],
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
