import { Module } from '@nestjs/common';
import { LocationsService } from './locations.service';
import { RatingsService } from './ratings.service';
import { LocationsController } from './locations.controller';
import { GeocodingService } from './geocoding.service';
import { EnrichmentService } from './enrichment.service';
import { CommunityModule } from '../community/community.module';
import { AppConfigModule } from '../app-config/app-config.module';
import { LocationVisibilityService } from '../../common/services/location-visibility.service';

@Module({
  imports: [
    CommunityModule,
    AppConfigModule,
  ],
  providers: [LocationsService, RatingsService, GeocodingService, EnrichmentService, LocationVisibilityService],
  controllers: [LocationsController],
  exports: [LocationsService, LocationVisibilityService],
})
export class LocationsModule {}
