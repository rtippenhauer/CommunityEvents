import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';

/**
 * Ephemeral per-visitor demo communities (v2-14).
 *
 * EmailModule for the one mail a demo causes -- its confirmation link, sent as
 * the deployment rather than as the demo, which cannot send anything.
 * TenantResolutionService comes from the global TenantModule.
 */
@Module({
  imports: [EmailModule],
  controllers: [DemoController],
  providers: [DemoService],
  exports: [DemoService],
})
export class DemoModule {}
