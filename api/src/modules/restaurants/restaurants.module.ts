import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RestaurantEntity } from '../../database/entities/restaurant.entity';
import { RestaurantPhotoEntity } from '../../database/entities/restaurant-photo.entity';
import { CityEntity } from '../../database/entities/city.entity';
import { RestaurantsService } from './restaurants.service';
import { RestaurantsController } from './restaurants.controller';
import { GeocodingService } from './geocoding.service';
import { EnrichmentService } from './enrichment.service';

@Module({
  imports: [TypeOrmModule.forFeature([RestaurantEntity, RestaurantPhotoEntity, CityEntity])],
  providers: [RestaurantsService, GeocodingService, EnrichmentService],
  controllers: [RestaurantsController],
  exports: [RestaurantsService],
})
export class RestaurantsModule {}
