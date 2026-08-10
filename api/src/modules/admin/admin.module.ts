import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    EmailModule,
    AuditModule,
  ],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
