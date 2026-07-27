import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReleaseEntity } from '../../database/entities/release.entity';
import { FeedbackEntity } from '../../database/entities/feedback.entity';
import { UserEntity } from '../../database/entities/user.entity';
import { ReleasesService } from './releases.service';
import { ReleasesController } from './releases.controller';
import { ReleasesAdminController } from './releases-admin.controller';
import { ReleaseNotesImporterService } from './release-notes-importer.service';

@Module({
  imports: [TypeOrmModule.forFeature([ReleaseEntity, FeedbackEntity, UserEntity])],
  providers: [ReleasesService, ReleaseNotesImporterService],
  controllers: [ReleasesController, ReleasesAdminController],
})
export class ReleasesModule {}
