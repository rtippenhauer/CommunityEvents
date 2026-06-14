import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RestaurantEntity } from '../../database/entities/restaurant.entity';
import { RestaurantPhotoEntity } from '../../database/entities/restaurant-photo.entity';
import { RestaurantRatingEntity } from '../../database/entities/restaurant-rating.entity';
import { CityEntity } from '../../database/entities/city.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { EventRsvpEntity } from '../../database/entities/event-rsvp.entity';
import { RestaurantsService } from './restaurants.service';
import { RatingsService } from './ratings.service';
import { RestaurantsController } from './restaurants.controller';
import { GeocodingService } from './geocoding.service';
import { EnrichmentService } from './enrichment.service';

@Module({
  imports: [TypeOrmModule.forFeature([
    RestaurantEntity,
    RestaurantPhotoEntity,
    RestaurantRatingEntity,
    CityEntity,
    EventEntity,
    EventRsvpEntity,
  ])],
  providers: [RestaurantsService, RatingsService, GeocodingService, EnrichmentService],
  controllers: [RestaurantsController],
  exports: [RestaurantsService],
})
export class RestaurantsModule {}
