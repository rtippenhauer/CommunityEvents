import { Module } from '@nestjs/common';
import { CitiesService } from './cities.service';
import { CityPreferencesService } from './city-preferences.service';
import { CitiesController } from './cities.controller';
import { CitiesAdminController } from './cities-admin.controller';
import { AppConfigModule } from '../app-config/app-config.module';

// AppConfigModule is imported rather than assumed: it is not `@Global` the way
// PrismaModule is, so injecting AppConfigService without this line is a boot
// failure that `tsc` passes clean (the trap recorded against v2-10).
@Module({
  imports: [AppConfigModule],
  providers: [CitiesService, CityPreferencesService],
  controllers: [CitiesController, CitiesAdminController],
  exports: [CitiesService, CityPreferencesService],
})
export class CitiesModule {}
