import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { OAuthConfigController } from './oauth-config.controller';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    EmailModule,
    AuditModule,
  ],
  providers: [AdminService],
  controllers: [AdminController, OAuthConfigController],
})
export class AdminModule {}
