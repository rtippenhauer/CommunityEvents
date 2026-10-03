import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DemoModule } from '../demo/demo.module';
import { EmailModule } from '../email/email.module';
import { DemoExpiryTask } from './demo-expiry.task';
import { EmailRetentionTask } from './email-retention.task';
import { HardDeleteTask } from './hard-delete.task';

@Module({
  imports: [
    AuditModule,
    DemoModule,
    EmailModule,
  ],
  providers: [DemoExpiryTask, EmailRetentionTask, HardDeleteTask],
  exports: [DemoExpiryTask],
})
export class TasksModule {}
