import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TenantSecretsController } from './tenant-secrets.controller';
import { TenantSecretsService } from './tenant-secrets.service';

/**
 * Global because the credentials it resolves are needed wherever a third-party
 * call is made, and those sites are spread across feature modules that have no
 * other reason to know about each other. The same argument PrismaModule makes,
 * and the alternative is importing this module into every feature that happens
 * to geocode something.
 */
@Global()
@Module({
  imports: [ConfigModule],
  controllers: [TenantSecretsController],
  providers: [TenantSecretsService],
  exports: [TenantSecretsService],
})
export class TenantSecretsModule {}
