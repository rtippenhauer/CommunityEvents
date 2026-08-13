import { Global, Module } from '@nestjs/common';
import { TenantResolutionService } from './tenant-resolution.service';

/**
 * Global because the resolution cache must be one instance process-wide — a
 * per-module copy would multiply the database lookups it exists to avoid, and
 * clearing one would leave the others stale.
 */
@Global()
@Module({
  providers: [TenantResolutionService],
  exports: [TenantResolutionService],
})
export class TenantModule {}
