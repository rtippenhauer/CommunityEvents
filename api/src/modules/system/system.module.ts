import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TenantsAdminController } from './tenants-admin.controller';
import { TenantsAdminService } from './tenants-admin.service';
import { TenantUsersController } from './tenant-users.controller';
import { TenantUsersService } from './tenant-users.service';

/**
 * Deployment-level administration, as opposed to the per-community
 * administration in AdminModule. Reachable only from the root tenant, and only
 * by a system_admin -- see SystemAdminGuard.
 *
 * TenantResolutionService is not imported here: TenantModule is @Global, and
 * the cache it owns has to be the one process-wide instance for the
 * invalidation on write to mean anything.
 */
@Module({
  imports: [AuditModule],
  providers: [TenantsAdminService, TenantUsersService],
  controllers: [TenantsAdminController, TenantUsersController],
})
export class SystemModule {}
