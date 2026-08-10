import { Module } from '@nestjs/common';
import { CitiesService } from './cities.service';
import { CitiesController } from './cities.controller';
import { CitiesAdminController } from './cities-admin.controller';

@Module({
  providers: [CitiesService],
  controllers: [CitiesController, CitiesAdminController],
  exports: [CitiesService],
})
export class CitiesModule {}
