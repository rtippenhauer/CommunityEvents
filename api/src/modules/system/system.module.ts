import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TenantsAdminController } from './tenants-admin.controller';
import { TenantsAdminService } from './tenants-admin.service';
import { TenantUsersController } from './tenant-users.controller';
import { TenantUsersService } from './tenant-users.service';
import { InboundMailController } from './inbound-mail.controller';
import { EmailModule } from '../email/email.module';

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
  // EmailModule for the one writer/reader of `inbound_emails`: the operator's
  // view is a second reader of the same service, never a second query (v2-34).
  imports: [AuditModule, EmailModule],
  providers: [TenantsAdminService, TenantUsersService],
  controllers: [TenantsAdminController, TenantUsersController, InboundMailController],
})
export class SystemModule {}
