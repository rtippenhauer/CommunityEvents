import { Module } from '@nestjs/common';
import { ReleasesService } from './releases.service';
import { ReleasesController } from './releases.controller';
import { ReleasesAdminController } from './releases-admin.controller';
import { ReleaseNotesImporterService } from './release-notes-importer.service';

@Module({
  providers: [ReleasesService, ReleaseNotesImporterService],
  controllers: [ReleasesController, ReleasesAdminController],
})
export class ReleasesModule {}
