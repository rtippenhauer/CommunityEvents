import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { FacebookDeletionRequestEntity } from '../../database/entities/facebook-deletion-request.entity';
import { AuditModule } from '../audit/audit.module';
import { HardDeleteTask } from './hard-delete.task';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, FacebookDeletionRequestEntity]),
    AuditModule,
  ],
  providers: [HardDeleteTask],
})
export class TasksModule {}
