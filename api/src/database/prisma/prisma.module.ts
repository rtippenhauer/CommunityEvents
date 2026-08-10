import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from './prisma.service';

/**
 * Global so feature modules can inject PrismaService without each one
 * importing a module first. This is the Prisma equivalent of the
 * `TypeOrmModule.forFeature(...)` lines being removed from every feature
 * module — with Prisma there is nothing per-entity to register, so a single
 * global provider replaces all of them.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
