import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReleaseEntity } from '../../database/entities/release.entity';
import { FeedbackEntity } from '../../database/entities/feedback.entity';
import { ReleasesService } from './releases.service';
import { ReleasesController } from './releases.controller';
import { ReleasesAdminController } from './releases-admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ReleaseEntity, FeedbackEntity])],
  providers: [ReleasesService],
  controllers: [ReleasesController, ReleasesAdminController],
})
export class ReleasesModule {}
