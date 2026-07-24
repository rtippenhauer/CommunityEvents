import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LocationEntity } from '../../database/entities/location.entity';
import { LocationPhotoEntity } from '../../database/entities/location-photo.entity';
import { LocationRatingEntity } from '../../database/entities/location-rating.entity';
import { CityEntity } from '../../database/entities/city.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { EventRsvpEntity } from '../../database/entities/event-rsvp.entity';
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
    TypeOrmModule.forFeature([
      LocationEntity,
      LocationPhotoEntity,
      LocationRatingEntity,
      CityEntity,
      EventEntity,
      EventRsvpEntity,
    ]),
    CommunityModule,
    AppConfigModule,
  ],
  providers: [LocationsService, RatingsService, GeocodingService, EnrichmentService, LocationVisibilityService],
  controllers: [LocationsController],
  exports: [LocationsService, LocationVisibilityService],
})
export class LocationsModule {}
