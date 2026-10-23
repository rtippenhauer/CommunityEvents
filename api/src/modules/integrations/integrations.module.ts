import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ApiTokenService } from './api-token.service';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/**
 * Integration accounts and their bearer tokens (v2-29).
 *
 * Exports both services because `MuseModule` needs them from the other side of
 * the request: `ApiTokenService` for the middleware that resolves a call's
 * community from its token, and `IntegrationsService` for Muse rotating its own
 * credential. Not `@Global` -- unlike `PrismaModule` or `TenantSecretsModule`,
 * exactly one other module needs it, and the trap `v2-10` recorded is that a
 * non-global module's service injected without the import is a **boot** failure
 * that `tsc` passes clean.
 */
@Module({
  imports: [AuditModule],
  controllers: [IntegrationsController],
  providers: [ApiTokenService, IntegrationsService],
  exports: [ApiTokenService, IntegrationsService],
})
export class IntegrationsModule {}
