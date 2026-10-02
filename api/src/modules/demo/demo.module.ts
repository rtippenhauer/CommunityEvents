import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';
import { DemoController } from './demo.controller';
import { DemoAdminController } from './demo-admin.controller';
import { DemoService } from './demo.service';

/**
 * Ephemeral per-visitor demo communities (v2-14).
 *
 * EmailModule for the one mail a demo causes -- its confirmation link, sent as
 * the deployment rather than as the demo, which cannot send anything.
 * AuditModule for the system admin's own actions on the operator screen.
 * TenantResolutionService comes from the global TenantModule.
 */
@Module({
  imports: [EmailModule, AuditModule],
  controllers: [DemoController, DemoAdminController],
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule {}
