import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaService } from './prisma.service';
import { secretEncryptionExtension } from './secret-encryption.extension';
import { tenantScopeExtension } from './tenant-scope.extension';

/**
 * Global so feature modules can inject PrismaService without each one
 * importing a module first. This is the Prisma equivalent of the
 * `TypeOrmModule.forFeature(...)` lines being removed from every feature
 * module — with Prisma there is nothing per-entity to register, so a single
 * global provider replaces all of them.
 *
 * The provider is a factory rather than the bare class because the two
 * enforcement layers arrive via `$extends`, which returns a *new* client rather
 * than mutating the one it was called on — so `PrismaService` cannot extend
 * itself in its own constructor. Binding the extended client to the
 * `PrismaService` token instead means all 40 injection sites keep working
 * untouched, and no service can accidentally reach the bare client: it is never
 * bound to a token at all. That matters twice over — the bare client is both
 * unscoped and unencrypting.
 *
 * Order: tenant scoping first, then secret encryption, which makes encryption
 * the outer wrapper. Nothing depends on that — scoping only reads and writes
 * `tenantId` and `where`, encryption only the columns declared in
 * `encrypted-columns.ts` — but reading the chain top-down as "encrypt around
 * scope around client" matches the order the two docblocks describe.
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
        new PrismaService(configService)
          .$extends(tenantScopeExtension)
          .$extends(secretEncryptionExtension) as unknown as PrismaService,
      inject: [ConfigService],
    },
  ],
  exports: [PrismaService],
})
export class PrismaModule {}
