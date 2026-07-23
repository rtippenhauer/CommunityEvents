import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigEntity } from '../../database/entities/app-config.entity';
import { AppConfigService } from './app-config.service';
import { AppConfigController } from './app-config.controller';
import { AppConfigAdminController } from './app-config-admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AppConfigEntity])],
  providers: [AppConfigService],
  controllers: [AppConfigController, AppConfigAdminController],
})
export class AppConfigModule {}
