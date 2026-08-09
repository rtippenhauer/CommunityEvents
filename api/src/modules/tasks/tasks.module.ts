import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { HardDeleteTask } from './hard-delete.task';

@Module({
  imports: [
    AuditModule,
  ],
  providers: [HardDeleteTask],
})
export class TasksModule {}
