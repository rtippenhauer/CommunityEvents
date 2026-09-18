import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { DemoResetTask } from './demo-reset.task';
import { HardDeleteTask } from './hard-delete.task';

@Module({
  imports: [
    AuditModule,
  ],
  providers: [DemoResetTask, HardDeleteTask],
  exports: [DemoResetTask],
})
export class TasksModule {}
