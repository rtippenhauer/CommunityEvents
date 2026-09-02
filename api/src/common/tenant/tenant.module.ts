import { Global, Module } from '@nestjs/common';
import { TenantResolutionService } from './tenant-resolution.service';
import { TenantOAuthService } from './tenant-oauth.service';

/**
 * Global because the resolution cache must be one instance process-wide — a
 * per-module copy would multiply the database lookups it exists to avoid, and
 * clearing one would leave the others stale.
 */
@Global()
@Module({
  providers: [TenantResolutionService, TenantOAuthService],
  exports: [TenantResolutionService, TenantOAuthService],
})
export class TenantModule {}
