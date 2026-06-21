import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../../database/entities/user.entity';
import { OAuthAccountEntity } from '../../database/entities/oauth-account.entity';
import { EmailProviderConfigEntity } from '../../database/entities/email-provider-config.entity';
import { AuditLogEntity } from '../../database/entities/audit-log.entity';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { EmailModule } from '../email/email.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, OAuthAccountEntity, EmailProviderConfigEntity, AuditLogEntity]),
    EmailModule,
    AuditModule,
  ],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
