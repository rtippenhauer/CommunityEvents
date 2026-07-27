import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigEntity } from '../../database/entities/app-config.entity';
import { AppConfigService } from './app-config.service';
import { AppConfigController } from './app-config.controller';
import { AppConfigAdminController } from './app-config-admin.controller';
import { FeatureGuard } from '../../common/guards/feature.guard';

@Module({
  imports: [TypeOrmModule.forFeature([AppConfigEntity])],
  providers: [AppConfigService, { provide: APP_GUARD, useClass: FeatureGuard }],
  controllers: [AppConfigController, AppConfigAdminController],
  exports: [AppConfigService],
})
export class AppConfigModule {}
