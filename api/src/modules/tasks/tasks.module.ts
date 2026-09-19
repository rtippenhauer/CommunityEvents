import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DemoModule } from '../demo/demo.module';
import { DemoExpiryTask } from './demo-expiry.task';
import { HardDeleteTask } from './hard-delete.task';

@Module({
  imports: [
    AuditModule,
    DemoModule,
  ],
  providers: [DemoExpiryTask, HardDeleteTask],
  exports: [DemoExpiryTask],
})
export class TasksModule {}
